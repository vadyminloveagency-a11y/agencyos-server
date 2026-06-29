import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const DREAM_LETTER_BOT_COMPOSE_URL = 'https://www.dream-singles.com/members/messaging/bot/';
const DREAM_LETTER_BOT_SEND_URL = 'https://www.dream-singles.com/members/messaging/bot/send';
const LETTERBOT_DEFAULT_AUDIENCE = 'online';
const LETTERBOT_MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const LETTERBOT_MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const LETTERBOT_SEND_TICK_MS = 10_000;
const LETTERBOT_BUILD_ID = '20260629-8';
const letterBotRunsInFlight = new Map();
const letterBotSendLoops = new Map();

function defaultLetterBotConfig() {
  return {
    enabled: false,
    intervalMinutes: 20,
    audienceFilter: LETTERBOT_DEFAULT_AUDIENCE,
    queueIndex: 0,
    lastRunAt: '',
    lastTemplateAt: '',
    lastSuccessAt: '',
    lastError: '',
    nextRunAt: '',
    menSentSession: 0,
    menSentToday: 0,
    menSentDay: '',
    sessionStartedAt: '',
    sendEvents: [],
    entries: []
  };
}

function normalizeLetterBotConfig(raw) {
  const base = defaultLetterBotConfig();
  if (!raw || typeof raw !== 'object') return base;
  const entries = Array.isArray(raw.entries)
    ? raw.entries.map(item => ({
      id: String(item?.id || crypto.randomUUID()),
      text: String(item?.text || ''),
      mediaType: ['none', 'photo', 'video'].includes(String(item?.mediaType || '')) ? String(item.mediaType) : 'none',
      mediaName: String(item?.mediaName || ''),
      mediaMime: String(item?.mediaMime || ''),
      mediaFile: String(item?.mediaFile || '')
    })).filter(item => item.text.trim() || item.mediaType !== 'none')
    : [];
  const singleEntry = singleLetterBotEntry(entries);
  const normalized = {
    ...base,
    enabled: raw.enabled === true,
    intervalMinutes: Math.min(240, Math.max(5, Number(raw.intervalMinutes) || 20)),
    audienceFilter: String(raw.audienceFilter || LETTERBOT_DEFAULT_AUDIENCE),
    queueIndex: 0,
    lastRunAt: String(raw.lastRunAt || ''),
    lastTemplateAt: String(raw.lastTemplateAt || ''),
    lastSuccessAt: String(raw.lastSuccessAt || ''),
    lastError: String(raw.lastError || ''),
    nextRunAt: String(raw.nextRunAt || ''),
    menSentSession: Math.max(0, Number(raw.menSentSession) || 0),
    menSentToday: Math.max(0, Number(raw.menSentToday) || 0),
    menSentDay: String(raw.menSentDay || ''),
    sessionStartedAt: String(raw.sessionStartedAt || ''),
    sendEvents: Array.isArray(raw.sendEvents)
      ? raw.sendEvents.map(item => String(item || '')).filter(Boolean).slice(-2000)
      : [],
    entries: singleEntry ? [singleEntry] : []
  };
  return recomputeLetterBotSendCounters(normalized);
}

function letterBotMediaDir(mediaRoot, profileId) {
  const safeId = String(profileId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const dir = path.join(mediaRoot, safeId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function letterBotMediaPath(mediaRoot, profileId, entryId, ext) {
  const safeEntry = String(entryId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(letterBotMediaDir(mediaRoot, profileId), `${safeEntry}.${ext}`);
}

function publicLetterBotEntry(entry, profileId, mediaRoot) {
  const item = {
    id: entry.id,
    text: entry.text,
    mediaType: entry.mediaType,
    mediaName: entry.mediaName,
    mediaMime: entry.mediaMime,
    hasMedia: false,
    mediaUrl: ''
  };
  if (entry.mediaFile && entry.mediaType !== 'none') {
    const absolute = path.join(mediaRoot, entry.mediaFile);
    if (fs.existsSync(absolute)) {
      item.hasMedia = true;
      item.mediaUrl = `/letterbot-media/${profileId}/${path.basename(absolute)}`;
    }
  }
  return item;
}

function publicLetterBotConfig(profile, profileId, mediaRoot) {
  const config = normalizeLetterBotConfig(profile?.letterBot);
  return {
    enabled: config.enabled,
    intervalMinutes: config.intervalMinutes,
    audienceFilter: config.audienceFilter || LETTERBOT_DEFAULT_AUDIENCE,
    audienceLabel: 'Online gentlemen (exclude Favorites, Contacts)',
    queueIndex: config.queueIndex,
    lastRunAt: config.lastRunAt,
    lastTemplateAt: config.lastTemplateAt,
    lastSuccessAt: config.lastSuccessAt,
    lastError: config.lastError,
    nextRunAt: config.nextRunAt,
    menSentSession: config.menSentSession,
    menSentToday: config.menSentToday,
    sessionStartedAt: config.sessionStartedAt,
    buildId: LETTERBOT_BUILD_ID,
    entries: config.entries.map(entry => publicLetterBotEntry(entry, profileId, mediaRoot))
  };
}

function parseLetterBotDataUrl(value, mediaType) {
  const text = String(value || '');
  if (mediaType === 'photo') {
    const match = text.match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) return null;
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > LETTERBOT_MAX_PHOTO_BYTES) return null;
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1].toLowerCase();
    return { buffer, ext, mime: `image/${match[1] === 'jpg' ? 'jpeg' : match[1]}` };
  }
  if (mediaType === 'video') {
    const match = text.match(/^data:video\/(mp4|webm);base64,([A-Za-z0-9+/=]+)$/i);
    if (!match || match[1].toLowerCase() !== 'mp4') return null;
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > LETTERBOT_MAX_VIDEO_BYTES) return null;
    return { buffer, ext: 'mp4', mime: 'video/mp4' };
  }
  return null;
}

function saveLetterBotMedia(mediaRoot, profileId, entryId, dataUrl, mediaType, mediaName = '') {
  const parsed = parseLetterBotDataUrl(dataUrl, mediaType);
  if (!parsed) throw new Error(mediaType === 'video' ? 'Use MP4 video up to 100 MB' : 'Use JPG, PNG or WebP up to 8 MB');
  const filePath = letterBotMediaPath(mediaRoot, profileId, entryId, parsed.ext);
  fs.writeFileSync(filePath, parsed.buffer);
  const relative = path.join(String(profileId).replace(/[^a-zA-Z0-9_-]/g, '_'), `${String(entryId).replace(/[^a-zA-Z0-9_-]/g, '_')}.${parsed.ext}`);
  return {
    mediaFile: relative.replace(/\\/g, '/'),
    mediaMime: parsed.mime,
    mediaName: String(mediaName || `media.${parsed.ext}`).slice(0, 180),
    absolutePath: filePath
  };
}

function deleteLetterBotMedia(mediaRoot, entry) {
  if (!entry?.mediaFile) return;
  const absolute = path.join(mediaRoot, entry.mediaFile);
  if (fs.existsSync(absolute)) fs.unlinkSync(absolute);
}

function letterBotTodayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function recomputeLetterBotSendCounters(config) {
  const today = letterBotTodayKey();
  const sessionStart = Date.parse(config.sessionStartedAt || '');
  const events = Array.isArray(config.sendEvents) ? config.sendEvents : [];
  let todayCount = 0;
  let sessionCount = 0;
  for (const at of events) {
    const stamp = String(at || '');
    const ts = Date.parse(stamp);
    if (!Number.isFinite(ts)) continue;
    if (stamp.slice(0, 10) === today) todayCount += 1;
    if (Number.isFinite(sessionStart) && ts >= sessionStart) sessionCount += 1;
  }
  config.menSentDay = today;
  config.menSentToday = todayCount;
  config.menSentSession = sessionCount;
  return config;
}

function ensureLetterBotDailyCounter(config) {
  return recomputeLetterBotSendCounters(config);
}

function resetLetterBotSessionCounters(config) {
  config.menSentSession = 0;
  config.sessionStartedAt = new Date().toISOString();
  return recomputeLetterBotSendCounters(config);
}

function recordLetterBotSends(profile, count = 1) {
  const config = normalizeLetterBotConfig(profile.letterBot);
  const delta = Math.max(0, Number(count) || 0);
  if (!delta) return config;
  const now = new Date().toISOString();
  const events = Array.isArray(config.sendEvents) ? config.sendEvents.slice() : [];
  for (let i = 0; i < delta; i += 1) events.push(now);
  config.sendEvents = events.slice(-2000);
  recomputeLetterBotSendCounters(config);
  config.lastSuccessAt = now;
  config.lastError = '';
  profile.letterBot = config;
  return config;
}

function singleLetterBotEntry(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const usable = list.filter(item => String(item?.text || '').trim() || item?.mediaType !== 'none');
  if (usable.length) return usable[0];
  if (list.length) return list[0];
  return null;
}

function pickLetterBotEntry(config) {
  const entry = singleLetterBotEntry(config.entries);
  if (!entry || !String(entry.text || '').trim()) return null;
  return { entry, index: 0, total: 1 };
}

function markLetterBotTemplateRun(profile, success = true) {
  const config = normalizeLetterBotConfig(profile.letterBot);
  const now = new Date();
  config.lastRunAt = now.toISOString();
  config.lastTemplateAt = now.toISOString();
  if (success) {
    config.lastError = '';
    config.queueIndex = 0;
  }
  const next = new Date(now.getTime() + config.intervalMinutes * 60_000);
  config.nextRunAt = next.toISOString();
  profile.letterBot = config;
  return config;
}

async function readDreamMenSentCount(page) {
  return page.evaluate(() => {
    const ids = ['sentCount', 'lettersSent', 'countSent', 'sentMen', 'menSent'];
    for (const id of ids) {
      const node = document.getElementById(id);
      if (!node) continue;
      const value = parseInt(String(node.textContent || node.value || '').replace(/[^\d]/g, ''), 10);
      if (Number.isFinite(value) && value >= 0) return value;
    }

    const dataNode = document.querySelector('[data-sent-count]');
    if (dataNode) {
      const value = parseInt(String(dataNode.getAttribute('data-sent-count') || dataNode.textContent || '').replace(/[^\d]/g, ''), 10);
      if (Number.isFinite(value) && value >= 0) return value;
    }

    const countNode = document.querySelector('.sent-count');
    if (countNode) {
      const value = parseInt(String(countNode.textContent || '').replace(/[^\d]/g, ''), 10);
      if (Number.isFinite(value) && value >= 0) return value;
    }

    const statusBox = document.querySelector('#sendStatus, .send-status, #mailingStats, .mailing-stats');
    if (statusBox) {
      const text = statusBox.innerText || '';
      const match = text.match(/(?:sent|processed|delivered)\s*[:\-]?\s*(\d+)/i);
      if (match) return parseInt(match[1], 10);
    }

    return null;
  }).catch(() => null);
}

async function confirmDreamLetterSend(page, beforeCount) {
  await page.waitForTimeout(2500);
  const afterCount = await readDreamMenSentCount(page);
  if (Number.isFinite(beforeCount) && Number.isFinite(afterCount) && afterCount > beforeCount) {
    return afterCount - beforeCount;
  }

  const alertConfirmed = await page.evaluate(() => {
    const alerts = [...document.querySelectorAll('.alert-success, .alert.alert-success')];
    return alerts.some(node => /message sent|letter sent|successfully sent|was sent/i.test(node.textContent || ''));
  }).catch(() => false);

  return alertConfirmed ? 1 : 0;
}

function stopLetterBotSendLoop(profileId) {
  const loop = letterBotSendLoops.get(String(profileId));
  if (loop?.timer) clearInterval(loop.timer);
  letterBotSendLoops.delete(String(profileId));
}

function startLetterBotSendLoop(deps, profileId) {
  const id = String(profileId);
  stopLetterBotSendLoop(id);
  const state = { timer: null, busy: false };

  const tick = () => {
    if (state.busy || letterBotRunsInFlight.has(id)) return;
    const db = deps.readDb();
    const profile = db.profiles?.[id];
    if (!profile || profile.active === false || !normalizeLetterBotConfig(profile.letterBot).enabled) {
      stopLetterBotSendLoop(id);
      return;
    }
    if (!deps.dreamSessions.has(id)) return;

    state.busy = true;
    trySendOneDreamLetter(deps, id)
      .catch(error => console.warn(`[letterbot] send tick ${id}: ${error.message || error}`))
      .finally(() => { state.busy = false; });
  };

  state.timer = setInterval(tick, LETTERBOT_SEND_TICK_MS);
  if (typeof state.timer.unref === 'function') state.timer.unref();
  letterBotSendLoops.set(id, state);
  tick();
}

function restoreLetterBotSendLoops(deps) {
  try {
    const db = deps.readDb();
    for (const profileId of Object.keys(db.profiles || {})) {
      const config = normalizeLetterBotConfig(db.profiles[profileId]?.letterBot);
      if (config.enabled) startLetterBotSendLoop(deps, profileId);
    }
  } catch (error) {
    console.warn('[letterbot] could not restore send loops', error.message || error);
  }
}

function profileLetterBotUser(db, profileId, currentAssignedUserForProfile) {
  const profile = db.profiles?.[profileId];
  if (!profile) return null;
  const assignee = typeof currentAssignedUserForProfile === 'function'
    ? currentAssignedUserForProfile(db, profileId)
    : null;
  if (assignee?.id && db.users?.[assignee.id]) return db.users[assignee.id];
  const ownerId = String(profile.ownerAdminId || '');
  if (ownerId && db.users?.[ownerId]) return db.users[ownerId];
  return Object.values(db.users || {}).find(user => (user.profileIds || []).includes(profileId)) || null;
}

async function dismissDreamPopups(page) {
  const labels = [/^OK$/i, /^I agree$/i, /^I don't want to know$/i, /^Enable Sound$/i];
  for (const label of labels) {
    const control = page.locator('button, a, input[type="button"], input[type="submit"]').filter({ hasText: label }).first();
    if (await control.count().catch(() => 0)) {
      await control.click({ timeout: 1500 }).catch(() => {});
    }
  }
}

async function gotoLetterBotUrl(page, targetUrl) {
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(1200);
  await dismissDreamPopups(page);
  const currentUrl = page.url();
  if (!/\/members\/messaging\/bot/i.test(currentUrl)) {
    throw new Error('Dream session expired. Turn profile Off and On again, then retry LetterBot.');
  }
  return currentUrl;
}

async function openLetterBotComposePage(page) {
  await gotoLetterBotUrl(page, DREAM_LETTER_BOT_COMPOSE_URL);
  await page.waitForSelector('.cke_wysiwyg_frame', { timeout: 45_000 });
}

async function openLetterBotSendPage(page) {
  await gotoLetterBotUrl(page, DREAM_LETTER_BOT_SEND_URL);
  await page.waitForSelector('input[type="radio"]', { timeout: 45_000 });
}

async function selectLetterBotOnlineFilter(page) {
  const label = page.locator('label').filter({ hasText: /Send Gentlemen Online/i }).first();
  if (await label.count()) {
    await label.click({ timeout: 10_000 });
    await page.waitForTimeout(500);
    return;
  }

  const radio = page.getByRole('radio', { name: /Gentlemen Online/i }).first();
  if (await radio.count()) {
    await radio.check({ timeout: 10_000 });
    await page.waitForTimeout(500);
    return;
  }

  const selected = await page.evaluate(() => {
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
  await page.waitForTimeout(500);
}

async function dreamSendPageState(page) {
  return page.evaluate(() => {
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

async function waitForDreamSendReady(page, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await dreamSendPageState(page);
    if (dreamSendPageReady(state)) return state;
    await page.waitForTimeout(800);
  }
  return null;
}

async function triggerDreamLetterSend(page) {
  const state = await dreamSendPageState(page);
  if (!dreamSendPageReady(state)) {
    const status = state?.spamValue || state?.sendButtonLabel || 'waiting';
    return { ok: false, reason: `Dream is not ready to send (status: ${status})` };
  }

  return page.evaluate(() => {
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

async function saveLetterBotTemplate(page, entry, mediaAbsolutePath) {
  await openLetterBotComposePage(page);
  const letterText = String(entry.text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const editorFrame = page.frameLocator('.cke_wysiwyg_frame.cke_reset').first();
  await editorFrame.locator('body').click({ timeout: 10_000 }).catch(() => {});
  await editorFrame.locator('body').evaluate((body, text) => {
    const paragraphs = [...body.querySelectorAll('p')];
    let first = paragraphs[0];
    if (!first) {
      first = body.ownerDocument.createElement('p');
      body.appendChild(first);
    }
    paragraphs.slice(1).forEach(node => node.remove());
    first.innerText = text;
  }, letterText);

  if (entry.mediaType === 'video' && mediaAbsolutePath) {
    let attached = false;
    const directVideo = page.locator('#bot_video');
    if (await directVideo.count()) {
      await directVideo.setInputFiles(mediaAbsolutePath);
      attached = true;
    }
    if (!attached) {
      await page.locator('a, button, [data-toggle="tab"], .nav-link').filter({ hasText: /boomerang|video/i }).first().click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1200);
      const input = page.locator('input[type="file"]').first();
      if (await input.count()) {
        await input.setInputFiles(mediaAbsolutePath);
        attached = true;
      }
    }
    if (!attached) throw new Error('Could not attach video on Letter Sendout page');
  } else if (entry.mediaType === 'photo' && mediaAbsolutePath) {
    await page.locator('a, button, [data-toggle="tab"], .nav-link').filter({ hasText: /attach photo|photo/i }).first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const input = page.locator('input[type="file"]').first();
    if (!(await input.count())) throw new Error('Could not find photo upload on Letter Sendout page');
    await input.setInputFiles(mediaAbsolutePath);
  }

  await page.waitForTimeout(1500);
  const composeSaveButton = page.locator('#bot_save');
  if (!(await composeSaveButton.count())) throw new Error('Save button was not found on Letter Sendout page');
  await composeSaveButton.click({ timeout: 15_000 });
  await page.waitForTimeout(2500);
}

async function sendLetterBotOnDream(page) {
  await openLetterBotSendPage(page);
  await selectLetterBotOnlineFilter(page);
  const ready = await waitForDreamSendReady(page);
  if (!ready) {
    throw new Error('Dream is not ready to send letters yet. Check that the template saved and the sendout page shows Ready to begin sending.');
  }
  const result = await triggerDreamLetterSend(page);
  if (!result?.ok) throw new Error(result?.reason || 'Could not send letter on Dream');
  await page.waitForTimeout(2000);
  return result;
}

async function trySendOneDreamLetter(deps, profileId) {
  const id = String(profileId || '');
  if (!id || !deps.dreamSessions.has(id)) return false;

  const db = deps.readDb();
  const profile = db.profiles?.[id];
  if (!profile || profile.active === false) return false;
  const config = normalizeLetterBotConfig(profile.letterBot);
  if (!config.enabled) return false;

  let browserSession = deps.dreamBrowserSessions.get(id);
  if (!browserSession?.page) {
    const user = profileLetterBotUser(db, id, deps.currentAssignedUserForProfile);
    if (!user) return false;
    browserSession = await deps.startDreamBrowser(db, user, id, { force: false, headless: true, refreshDreamSession: false });
  }

  const page = browserSession.page;
  await openLetterBotSendPage(page).catch(() => {});
  await selectLetterBotOnlineFilter(page).catch(() => {});
  const ready = await waitForDreamSendReady(page, 5000);
  if (!ready) return false;

  const beforeCount = await readDreamMenSentCount(page);
  const result = await triggerDreamLetterSend(page);
  if (!result?.ok) return false;

  const sentCount = await confirmDreamLetterSend(page, beforeCount);
  if (!sentCount) return false;

  recordLetterBotSends(profile, sentCount);
  profile.updatedAt = new Date().toISOString();
  deps.writeDb(db);
  return true;
}

async function runLetterBotNow(deps, profileId, options = {}) {
  const id = String(profileId || '');
  if (!id) throw new Error('Profile id is required');
  if (letterBotRunsInFlight.has(id)) throw new Error('LetterBot is already running for this profile');
  letterBotRunsInFlight.set(id, true);
  try {
    const db = deps.readDb();
    const profile = db.profiles?.[id];
    if (!profile || profile.active === false) throw new Error('Profile not found');
    const config = normalizeLetterBotConfig(profile.letterBot);
    const picked = pickLetterBotEntry(config);
    if (!picked) throw new Error('Add at least one letter text');
    const entry = picked.entry;
    if (!deps.dreamSessions.has(id)) throw new Error('Profile is not connected on the server');

    const user = profileLetterBotUser(db, id, deps.currentAssignedUserForProfile);
    if (!user) throw new Error('No operator is assigned to this profile');

    let mediaAbsolutePath = '';
    if (entry.mediaType !== 'none' && entry.mediaFile) {
      mediaAbsolutePath = path.join(deps.letterBotMediaRoot, entry.mediaFile);
      if (!fs.existsSync(mediaAbsolutePath)) throw new Error('Letter media file is missing. Upload it again.');
    } else if (entry.mediaType !== 'none') {
      throw new Error('This letter requires a photo or video file');
    }

    let browserSession = deps.dreamBrowserSessions.get(id);
    if (!browserSession?.page) {
      browserSession = await deps.startDreamBrowser(db, user, id, { force: false, headless: true, refreshDreamSession: true });
    }
    const page = browserSession.page;
    await page.goto('https://www.dream-singles.com/members/messaging/inbox', { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
    await saveLetterBotTemplate(page, entry, mediaAbsolutePath);
    markLetterBotTemplateRun(profile, true);

    const templateOnly = options.templateOnly === true;
    if (!templateOnly) {
      await openLetterBotSendPage(page);
      await selectLetterBotOnlineFilter(page);
      const ready = await waitForDreamSendReady(page);
      if (!ready) throw new Error('Dream is not ready to send letters yet. Check that the template saved and the sendout page shows Ready to begin sending.');
      const beforeCount = await readDreamMenSentCount(page);
      const sendResult = await triggerDreamLetterSend(page);
      if (!sendResult?.ok) throw new Error(sendResult?.reason || 'Could not send letter on Dream');
      const sentCount = await confirmDreamLetterSend(page, beforeCount);
      if (sentCount) recordLetterBotSends(profile, sentCount);
    }

    if (options.enable === true) {
      profile.letterBot.enabled = true;
      startLetterBotSendLoop(deps, id);
    } else if (normalizeLetterBotConfig(profile.letterBot).enabled) {
      startLetterBotSendLoop(deps, id);
    }

    profile.updatedAt = new Date().toISOString();
    deps.writeDb(db);
    return publicLetterBotConfig(profile, id, deps.letterBotMediaRoot);
  } catch (error) {
    const db = deps.readDb();
    const profile = db.profiles?.[id];
    if (profile) {
      const config = normalizeLetterBotConfig(profile.letterBot);
      config.lastRunAt = new Date().toISOString();
      config.lastError = error.message || 'LetterBot failed';
      profile.letterBot = config;
      profile.updatedAt = new Date().toISOString();
      deps.writeDb(db);
    }
    throw error;
  } finally {
    letterBotRunsInFlight.delete(id);
  }
}

async function maybeRunLetterBot(deps, profileId) {
  const id = String(profileId || '');
  const db = deps.readDb();
  const profile = db.profiles?.[id];
  if (!profile || profile.active === false) return false;
  const config = normalizeLetterBotConfig(profile.letterBot);
  if (!config.enabled) return false;
  if (!deps.dreamSessions.has(id)) return false;
  if (letterBotRunsInFlight.has(id)) return false;
  const now = Date.now();
  if (config.nextRunAt && new Date(config.nextRunAt).getTime() > now) return false;
  if (!config.nextRunAt && config.lastTemplateAt) {
    const last = new Date(config.lastTemplateAt).getTime();
    if (now - last < config.intervalMinutes * 60_000) return false;
  }
  await runLetterBotNow(deps, id, { templateOnly: false });
  return true;
}

function registerLetterBotRoutes(app, deps) {
  const { requireUser, requireProfileForUser, readDb, writeDb, letterBotMediaRoot } = deps;

  app.get('/api/profiles/:id/letterbot', requireUser, (req, res) => {
    const db = readDb();
    const id = String(req.params.id);
    try {
      requireProfileForUser(db, req.user, id);
      const profile = db.profiles[id];
      res.json({ ok: true, letterbot: publicLetterBotConfig(profile, id, letterBotMediaRoot) });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: error.message || 'Could not load LetterBot' });
    }
  });

  app.put('/api/profiles/:id/letterbot', requireUser, (req, res) => {
    const db = readDb();
    const id = String(req.params.id);
    try {
      const profile = requireProfileForUser(db, req.user, id);
      const current = normalizeLetterBotConfig(profile.letterBot);
      const incomingEntries = (Array.isArray(req.body?.entries) ? req.body.entries : current.entries).slice(0, 1);
      const entries = incomingEntries.map(item => {
        const entryId = String(item?.id || crypto.randomUUID());
        const existing = current.entries.find(row => row.id === entryId);
        const mediaType = ['none', 'photo', 'video'].includes(String(item?.mediaType || ''))
          ? String(item.mediaType)
          : (existing?.mediaType || 'none');
        const next = {
          id: entryId,
          text: String(item?.text || ''),
          mediaType,
          mediaName: existing?.mediaName || '',
          mediaMime: existing?.mediaMime || '',
          mediaFile: existing?.mediaFile || ''
        };
        if (mediaType === 'none') {
          if (existing?.mediaFile) deleteLetterBotMedia(letterBotMediaRoot, existing);
          next.mediaName = '';
          next.mediaMime = '';
          next.mediaFile = '';
        }
        return next;
      }).filter(item => item.text.trim() || item.mediaType !== 'none');
      const keptId = entries[0]?.id || '';
      for (const old of current.entries) {
        if (keptId && old.id !== keptId && old.mediaFile) deleteLetterBotMedia(letterBotMediaRoot, old);
      }
      profile.letterBot = normalizeLetterBotConfig({
        ...current,
        intervalMinutes: Math.min(240, Math.max(5, Number(req.body?.intervalMinutes) || current.intervalMinutes || 20)),
        entries
      });
      profile.updatedAt = new Date().toISOString();
      writeDb(db);
      res.json({ ok: true, letterbot: publicLetterBotConfig(profile, id, letterBotMediaRoot) });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: error.message || 'Could not save LetterBot' });
    }
  });

  app.post('/api/profiles/:id/letterbot/media', requireUser, (req, res) => {
    const db = readDb();
    const id = String(req.params.id);
    try {
      const profile = requireProfileForUser(db, req.user, id);
      const config = normalizeLetterBotConfig(profile.letterBot);
      const entryId = String(req.body?.entryId || '');
      const mediaType = String(req.body?.mediaType || '');
      if (!entryId) return res.status(400).json({ ok: false, error: 'Entry id is required' });
      if (!['photo', 'video'].includes(mediaType)) return res.status(400).json({ ok: false, error: 'Media type must be photo or video' });
      const durationSec = Number(req.body?.durationSec || 0);
      if (mediaType === 'video' && (!durationSec || durationSec > 3.05)) {
        return res.status(400).json({ ok: false, error: 'Dream Singles allows videos up to 3 seconds only' });
      }
      let entry = config.entries.find(item => item.id === entryId);
      if (!entry) {
        entry = { id: entryId, text: '', mediaType: 'none', mediaName: '', mediaMime: '', mediaFile: '' };
        config.entries.push(entry);
      }
      if (entry.mediaFile) deleteLetterBotMedia(letterBotMediaRoot, entry);
      const saved = saveLetterBotMedia(
        letterBotMediaRoot,
        id,
        entryId,
        String(req.body?.dataUrl || ''),
        mediaType,
        String(req.body?.name || '')
      );
      entry.mediaType = mediaType;
      entry.mediaFile = saved.mediaFile;
      entry.mediaMime = saved.mediaMime;
      entry.mediaName = saved.mediaName;
      profile.letterBot = config;
      profile.updatedAt = new Date().toISOString();
      writeDb(db);
      res.json({ ok: true, entry: publicLetterBotEntry(entry, id, letterBotMediaRoot) });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: error.message || 'Could not save media' });
    }
  });

  app.delete('/api/profiles/:id/letterbot/media/:entryId', requireUser, (req, res) => {
    const db = readDb();
    const id = String(req.params.id);
    const entryId = String(req.params.entryId || '');
    try {
      const profile = requireProfileForUser(db, req.user, id);
      const config = normalizeLetterBotConfig(profile.letterBot);
      const entry = config.entries.find(item => item.id === entryId);
      if (entry?.mediaFile) deleteLetterBotMedia(letterBotMediaRoot, entry);
      if (entry) {
        entry.mediaType = 'none';
        entry.mediaFile = '';
        entry.mediaMime = '';
        entry.mediaName = '';
      }
      profile.letterBot = config;
      profile.updatedAt = new Date().toISOString();
      writeDb(db);
      res.json({ ok: true });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: error.message || 'Could not remove media' });
    }
  });

  app.post('/api/profiles/:id/letterbot/start', requireUser, async (req, res) => {
    const id = String(req.params.id);
    try {
      const db = readDb();
      const profile = requireProfileForUser(db, req.user, id);
      const config = normalizeLetterBotConfig(profile.letterBot);
      if (!pickLetterBotEntry(config)) return res.status(400).json({ ok: false, error: 'Add at least one letter text' });
      config.enabled = true;
      config.nextRunAt = new Date().toISOString();
      resetLetterBotSessionCounters(config);
      profile.letterBot = config;
      profile.updatedAt = new Date().toISOString();
      writeDb(db);
      const letterbot = await runLetterBotNow(deps, id, { enable: true });
      res.json({ ok: true, letterbot });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: error.message || 'Could not start LetterBot' });
    }
  });

  app.post('/api/profiles/:id/letterbot/stop', requireUser, (req, res) => {
    const db = readDb();
    const id = String(req.params.id);
    try {
      const profile = requireProfileForUser(db, req.user, id);
      const config = normalizeLetterBotConfig(profile.letterBot);
      config.enabled = false;
      profile.letterBot = config;
      profile.updatedAt = new Date().toISOString();
      stopLetterBotSendLoop(id);
      writeDb(db);
      res.json({ ok: true, letterbot: publicLetterBotConfig(profile, id, letterBotMediaRoot) });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: error.message || 'Could not stop LetterBot' });
    }
  });

  app.post('/api/profiles/:id/letterbot/clear', requireUser, (req, res) => {
    const db = readDb();
    const id = String(req.params.id);
    try {
      const profile = requireProfileForUser(db, req.user, id);
      const config = normalizeLetterBotConfig(profile.letterBot);
      if (config.enabled) {
        return res.status(400).json({ ok: false, error: 'Stop mailing before deleting the letter' });
      }
      for (const entry of config.entries) {
        if (entry?.mediaFile) deleteLetterBotMedia(letterBotMediaRoot, entry);
      }
      profile.letterBot = normalizeLetterBotConfig({
        ...config,
        entries: [{
          id: crypto.randomUUID(),
          text: '',
          mediaType: 'none',
          mediaName: '',
          mediaMime: '',
          mediaFile: ''
        }]
      });
      profile.updatedAt = new Date().toISOString();
      writeDb(db);
      res.json({ ok: true, letterbot: publicLetterBotConfig(profile, id, letterBotMediaRoot) });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: error.message || 'Could not clear letter' });
    }
  });

  app.post('/api/profiles/:id/letterbot/send-now', requireUser, async (req, res) => {
    const id = String(req.params.id);
    try {
      const letterbot = await runLetterBotNow(deps, id, {});
      res.json({ ok: true, letterbot });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: error.message || 'Could not send letter' });
    }
  });
}

function startLetterBotScheduler(deps) {
  restoreLetterBotSendLoops(deps);
  setInterval(() => {
    try {
      const db = deps.readDb();
      for (const profileId of Object.keys(db.profiles || {})) {
        maybeRunLetterBot(deps, profileId).catch(error => {
          console.warn(`[letterbot] ${profileId}: ${error.message || error}`);
        });
      }
    } catch (error) {
      console.warn('[letterbot] scheduler failed', error.message || error);
    }
  }, 60_000).unref?.();
}

export {
  defaultLetterBotConfig,
  normalizeLetterBotConfig,
  publicLetterBotConfig,
  registerLetterBotRoutes,
  startLetterBotScheduler,
  maybeRunLetterBot,
  runLetterBotNow,
  stopLetterBotSendLoop,
  restoreLetterBotSendLoops,
  LETTERBOT_BUILD_ID
};
