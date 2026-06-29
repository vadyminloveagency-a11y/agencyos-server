const DREAM_LETTER_BOT_COMPOSE_URL = 'https://www.dream-singles.com/members/messaging/bot/';
const DREAM_LETTER_BOT_SEND_URL = 'https://www.dream-singles.com/members/messaging/bot/send';
const DREAM_INBOX_URL = 'https://www.dream-singles.com/members/messaging/inbox';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runInPage(webContents, fn, arg) {
  const source = `(() => {
    const fn = ${fn.toString()};
    return fn(${JSON.stringify(arg)});
  })()`;
  return webContents.executeJavaScript(source, true);
}

async function dismissDreamPopups(webContents) {
  await runInPage(webContents, () => {
    const labels = [/^OK$/i, /^I agree$/i, /^I don't want to know$/i, /^Enable Sound$/i];
    const controls = [...document.querySelectorAll('button, a, input[type="button"], input[type="submit"]')];
    for (const label of labels) {
      const control = controls.find(node => label.test((node.textContent || node.value || '').trim()));
      if (control) control.click();
    }
    return true;
  });
}

async function gotoLetterBotUrl(webContents, targetUrl) {
  await webContents.loadURL(targetUrl);
  await sleep(1400);
  await dismissDreamPopups(webContents);
  const currentUrl = webContents.getURL();
  if (!/\/members\/messaging\/bot/i.test(currentUrl)) {
    throw new Error('Dream session expired. Turn profile Off and On again, then retry LetterBot.');
  }
  return currentUrl;
}

async function waitForSelector(webContents, selector, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await webContents.executeJavaScript(
      `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
      true
    );
    if (found) return true;
    await sleep(400);
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

async function setFileInputFiles(webContents, selector, filePaths) {
  const dbg = webContents.debugger;
  const attachedHere = !dbg.isAttached();
  if (attachedHere) dbg.attach('1.3');
  try {
    const { root } = await dbg.sendCommand('DOM.getDocument');
    const { nodeId } = await dbg.sendCommand('DOM.querySelector', {
      nodeId: root.nodeId,
      selector
    });
    if (!nodeId) throw new Error(`File input not found: ${selector}`);
    await dbg.sendCommand('DOM.setFileInputFiles', {
      nodeId,
      files: filePaths
    });
  } finally {
    if (attachedHere && dbg.isAttached()) dbg.detach();
  }
}

async function clickByText(webContents, pattern) {
  return runInPage(webContents, patternSource => {
    const pattern = new RegExp(patternSource, 'i');
    const nodes = [...document.querySelectorAll('a, button, [data-toggle="tab"], .nav-link, label')];
    const target = nodes.find(node => pattern.test(node.textContent || ''));
    if (!target) return false;
    target.click();
    return true;
  }, pattern);
}

async function saveLetterBotTemplate(webContents, entry, mediaAbsolutePath) {
  await gotoLetterBotUrl(webContents, DREAM_LETTER_BOT_COMPOSE_URL);
  await waitForSelector(webContents, '.cke_wysiwyg_frame');

  const letterText = String(entry.text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  await runInPage(webContents, text => {
    const frame = document.querySelector('.cke_wysiwyg_frame.cke_reset');
    const body = frame?.contentDocument?.body;
    if (!body) return false;
    const paragraphs = [...body.querySelectorAll('p')];
    let first = paragraphs[0];
    if (!first) {
      first = body.ownerDocument.createElement('p');
      body.appendChild(first);
    }
    paragraphs.slice(1).forEach(node => node.remove());
    first.innerText = text;
    return true;
  }, letterText);

  if (entry.mediaType === 'video' && mediaAbsolutePath) {
    let attached = false;
    const hasDirect = await webContents.executeJavaScript('Boolean(document.querySelector("#bot_video"))', true);
    if (hasDirect) {
      await setFileInputFiles(webContents, '#bot_video', [mediaAbsolutePath]);
      attached = true;
    }
    if (!attached) {
      await clickByText(webContents, 'boomerang|video');
      await sleep(1200);
      await setFileInputFiles(webContents, 'input[type="file"]', [mediaAbsolutePath]);
    }
  } else if (entry.mediaType === 'photo' && mediaAbsolutePath) {
    await clickByText(webContents, 'attach photo|photo');
    await sleep(1200);
    await setFileInputFiles(webContents, 'input[type="file"]', [mediaAbsolutePath]);
  }

  await sleep(1500);
  const saved = await runInPage(webContents, () => {
    const button = document.querySelector('#bot_save');
    if (!button) return false;
    button.click();
    return true;
  });
  if (!saved) throw new Error('Save button was not found on Letter Sendout page');
  await sleep(2500);
}

async function selectLetterBotOnlineFilter(webContents) {
  const selected = await runInPage(webContents, () => {
    const clickRadio = input => {
      if (!input) return false;
      input.scrollIntoView({ block: 'center' });
      input.click();
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return input.checked;
    };

    const labels = [...document.querySelectorAll('label')];
    const onlineLabel = labels.find(node => /send gentlemen online/i.test(node.textContent || ''));
    if (onlineLabel) {
      onlineLabel.click();
      const nested = onlineLabel.querySelector('input[type="radio"]');
      if (clickRadio(nested)) return true;
      const linked = document.getElementById(onlineLabel.getAttribute('for') || '');
      if (clickRadio(linked)) return true;
    }

    const radios = [...document.querySelectorAll('input[type="radio"]')];
    const onlineRadio = radios.find(input => {
      const bits = [
        input.id,
        input.name,
        input.value,
        input.getAttribute('aria-label'),
        input.closest('label')?.textContent
      ].join(' ');
      return /gentlemen online|online only|^online$/i.test(bits);
    });
    if (clickRadio(onlineRadio)) return true;
    return clickRadio(radios[0]);
  });
  if (!selected) throw new Error('Could not select Online filter on Letter Sendout page');
  await sleep(500);
}

async function dreamSendPageState(webContents) {
  return runInPage(webContents, () => {
    const spam = document.getElementById('spam');
    const spamValue = spam?.value ?? spam?.getAttribute?.('value') ?? '';
    const bodyText = document.body?.innerText || '';
    const readyByText = /ready to begin sending/i.test(bodyText);
    const sendButton = document.querySelector('.btn-success')
      || [...document.querySelectorAll('button, input[type="submit"], input[type="button"], a')].find(el => {
        if (el.disabled || el.offsetParent === null) return false;
        const label = (el.textContent || el.value || '').trim();
        return /^(start|send|begin)/i.test(label);
      })
      || null;
    return {
      spamValue,
      hasSpam: Boolean(spam),
      readyBySpam: spamValue === 'Start',
      readyByText,
      hasSendButton: Boolean(sendButton),
      sendButtonLabel: sendButton ? (sendButton.textContent || sendButton.value || '').trim() : ''
    };
  });
}

function dreamSendPageReady(state) {
  if (!state) return false;
  if (state.readyBySpam || state.readyByText) return true;
  return !state.hasSpam && state.hasSendButton;
}

async function waitForDreamSendReady(webContents, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await dreamSendPageState(webContents);
    if (dreamSendPageReady(state)) return state;
    await sleep(800);
  }
  return null;
}

async function triggerDreamLetterSend(webContents) {
  const state = await dreamSendPageState(webContents);
  if (!dreamSendPageReady(state)) {
    const status = state?.spamValue || state?.sendButtonLabel || 'waiting';
    return { ok: false, reason: `Dream is not ready to send (status: ${status})` };
  }
  return runInPage(webContents, () => {
    const inputLastActivity = document.getElementById('inputLastActivity');
    if (inputLastActivity?.options?.length > 1) {
      inputLastActivity.selectedIndex = 1;
      inputLastActivity.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const onlineCheckbox = document.getElementById('onlineOnly');
    if (onlineCheckbox) {
      onlineCheckbox.checked = true;
      onlineCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      const labels = [...document.querySelectorAll('label')];
      const onlineLabel = labels.find(node => /send gentlemen online/i.test(node.textContent || ''));
      if (onlineLabel) {
        onlineLabel.click();
      } else {
        const radios = [...document.querySelectorAll('input[type="radio"]')];
        const onlineRadio = radios.find(input => /gentlemen online/i.test([
          input.id,
          input.name,
          input.value,
          input.closest('label')?.textContent
        ].join(' ')));
        if (onlineRadio) {
          onlineRadio.checked = true;
          onlineRadio.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }

    const sendButton = document.querySelector('.btn-success')
      || [...document.querySelectorAll('button, input[type="submit"], input[type="button"], a')].find(el => {
        if (el.disabled || el.offsetParent === null) return false;
        const label = (el.textContent || el.value || '').trim();
        return /^(start|send|begin)/i.test(label);
      });
    if (!sendButton) return { ok: false, reason: 'Send button was not found on Letter Sendout page' };
    sendButton.click();
    return { ok: true };
  });
}

async function readDreamSendPageStats(webContents) {
  return runInPage(webContents, () => {
    const parseCount = value => {
      const match = String(value || '').match(/(\d[\d,]*)/);
      if (!match) return null;
      const parsed = parseInt(match[1].replace(/,/g, ''), 10);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    };

    const result = { dailyTotal: null, sessionSent: null };
    const bodyText = document.body?.innerText || '';
    const dailyMatch = bodyText.match(/Daily\s*Total\s*:?\s*([\d,]+)/i);
    if (dailyMatch) result.dailyTotal = parseCount(dailyMatch[1]);
    const sessionMatch = bodyText.match(/Successfully\s+sent\s+([\d,]+)\s+letters?/i);
    if (sessionMatch) result.sessionSent = parseCount(sessionMatch[1]);

    const sentCountNode = document.getElementById('sentCount');
    if (sentCountNode && result.sessionSent == null) {
      result.sessionSent = parseCount(sentCountNode.textContent || sentCountNode.value);
    }
    if (result.dailyTotal == null && result.sessionSent == null) return null;
    return result;
  });
}

async function dreamSendWasConfirmed(webContents, beforeStats, afterStats) {
  if (
    Number.isFinite(beforeStats?.sessionSent) &&
    Number.isFinite(afterStats?.sessionSent) &&
    afterStats.sessionSent > beforeStats.sessionSent
  ) {
    return true;
  }
  if (
    Number.isFinite(beforeStats?.dailyTotal) &&
    Number.isFinite(afterStats?.dailyTotal) &&
    afterStats.dailyTotal > beforeStats.dailyTotal
  ) {
    return true;
  }
  return runInPage(webContents, () => {
    const alerts = [...document.querySelectorAll('.alert-success, .alert.alert-success')];
    return alerts.some(node => /message sent|letter sent|successfully sent|was sent/i.test(node.textContent || ''));
  });
}

async function openLetterBotSendPage(webContents) {
  await gotoLetterBotUrl(webContents, DREAM_LETTER_BOT_SEND_URL);
  await waitForSelector(webContents, 'input[type="radio"]');
}

async function sendLetterBotOnDream(webContents) {
  await openLetterBotSendPage(webContents);
  await selectLetterBotOnlineFilter(webContents);
  const ready = await waitForDreamSendReady(webContents);
  if (!ready) {
    throw new Error('Dream is not ready to send letters yet. Check that the template saved and the sendout page shows Ready to begin sending.');
  }
  const result = await triggerDreamLetterSend(webContents);
  if (!result?.ok) throw new Error(result?.reason || 'Could not send letter on Dream');
  await sleep(2000);
  return result;
}

export {
  DREAM_INBOX_URL,
  sleep,
  saveLetterBotTemplate,
  openLetterBotSendPage,
  selectLetterBotOnlineFilter,
  waitForDreamSendReady,
  triggerDreamLetterSend,
  readDreamSendPageStats,
  dreamSendWasConfirmed,
  sendLetterBotOnDream
};
