(() => {
  const panel = document.querySelector('[data-agency-panel="letterbot"]');
  if (!panel) return;

  const noAccess = document.getElementById('agencyLetterBotNoAccess');
  const content = document.getElementById('agencyLetterBotContent');
  const authorizeBtn = document.getElementById('agencyLetterBotAuthorizeBtn');
  const sideStatusEl = document.getElementById('agencyLetterBotSideStatus');
  const sideStatusTextEl = document.getElementById('agencyLetterBotSideStatusText');
  const sideStartedEl = document.getElementById('agencyLetterBotSideStarted');
  const statTodayEl = document.getElementById('agencyLetterBotStatToday');
  const statSessionEl = document.getElementById('agencyLetterBotStatSession');
  const errorEl = document.getElementById('agencyLetterBotError');
  const buildEl = document.getElementById('agencyLetterBotBuild');
  const countdownEl = document.getElementById('agencyLetterBotCountdown');
  const intervalInput = document.getElementById('agencyLetterBotInterval');
  const entriesRoot = document.getElementById('agencyLetterBotEntries');
  const controlsRoot = document.getElementById('agencyLetterBotControls');
  const saveBtn = document.getElementById('agencyLetterBotSaveBtn');
  const startBtn = document.getElementById('agencyLetterBotStartBtn');
  const stopBtn = document.getElementById('agencyLetterBotStopBtn');
  const sendNowBtn = document.getElementById('agencyLetterBotSendNowBtn');
  const clearBtn = document.getElementById('agencyLetterBotClearBtn');
  const previewModal = document.getElementById('agencyLetterBotPreviewModal');
  const previewBody = document.getElementById('agencyLetterBotPreviewBody');
  const previewCloseBtn = document.getElementById('agencyLetterBotPreviewClose');

  const EXPECTED_BUILD = '20260629-8';

  let letterBotState = null;
  let letterBotBuildId = '';
  let letterBotCountdownTimer = null;
  let letterBotPollTimer = null;

  function activeProfileId() {
    return String(window.activeProfileId || localStorage.getItem('dream_crm_profile_id') || '');
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatLetterTextHtml(text) {
    const safe = escapeHtml(text).replace(/\n/g, '<br>');
    return safe.replace(/(Myjchina)/gi, '<span class="agency-letterbot-word-glow">$1</span>');
  }

  function syncLetterTextHighlight(entryId) {
    const textarea = entriesRoot?.querySelector(`[data-entry-text="${entryId}"]`);
    const highlight = entriesRoot?.querySelector(`[data-entry-highlight="${entryId}"]`);
    if (!textarea || !highlight) return;
    highlight.innerHTML = `${formatLetterTextHtml(textarea.value)}<br>`;
    highlight.scrollTop = textarea.scrollTop;
    highlight.scrollLeft = textarea.scrollLeft;
  }

  function profileOnline() {
    return typeof window.isActiveProfileOnline === 'function' && window.isActiveProfileOnline();
  }

  function syncLetterBotAccess() {
    const roleAllowed = ['admin', 'operator'].includes(window.currentUser?.role);
    const allowed = roleAllowed && profileOnline();
    panel?.classList.toggle('is-locked', !allowed);
    noAccess?.classList.toggle('hidden', allowed);
    content?.classList.toggle('hidden', !allowed);
    authorizeBtn?.classList.toggle('hidden', !roleAllowed || profileOnline());
    return allowed;
  }

  function formatCountdown(iso) {
    if (!iso) return '—';
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return 'soon';
    const totalSec = Math.ceil(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${String(sec).padStart(2, '0')}`;
  }

  function formatStartedAt(iso) {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function updateLetterBotStatus() {
    if (!letterBotState) return;

    const running = letterBotState.enabled === true;
    const session = Number(letterBotState.menSentSession) || 0;
    const today = Number(letterBotState.menSentToday) || 0;

    if (sideStatusEl && sideStatusTextEl) {
      sideStatusEl.classList.remove('is-running', 'is-stopped', 'is-finished', 'is-error');
      if (letterBotState.lastError && !running) {
        sideStatusEl.classList.add('is-error');
        sideStatusTextEl.textContent = 'Error';
      } else if (running) {
        sideStatusEl.classList.add('is-running');
        sideStatusTextEl.textContent = 'Running';
      } else if (session > 0) {
        sideStatusEl.classList.add('is-finished');
        sideStatusTextEl.textContent = 'Finished';
      } else {
        sideStatusEl.classList.add('is-stopped');
        sideStatusTextEl.textContent = 'Stopped';
      }
    }

    if (sideStartedEl) {
      sideStartedEl.textContent = running || letterBotState.sessionStartedAt
        ? formatStartedAt(letterBotState.sessionStartedAt)
        : '—';
    }

    if (statTodayEl) statTodayEl.textContent = String(today);
    if (statSessionEl) statSessionEl.textContent = String(session);

    if (countdownEl) {
      countdownEl.textContent = running
        ? `~10 sec · refresh in ${formatCountdown(letterBotState.nextRunAt)}`
        : 'Press Start mailing to send this letter';
    }

    if (errorEl) {
      const message = String(letterBotState.lastError || '').trim();
      errorEl.textContent = message;
      errorEl.classList.toggle('hidden', !message);
    }

    if (buildEl) {
      const build = letterBotState.buildId || letterBotBuildId || '';
      const stale = build !== EXPECTED_BUILD;
      buildEl.textContent = stale
        ? `Build ${build || 'old'} · redeploy Render and hard-refresh (Ctrl+Shift+R)`
        : `Build ${build}`;
      buildEl.classList.toggle('is-stale', stale);
    }

    if (startBtn) startBtn.disabled = running;
    if (stopBtn) stopBtn.disabled = !running;
    if (clearBtn) clearBtn.disabled = running;
  }

  function syncMediaBarGlow() {
    const entryNode = entriesRoot?.querySelector('.agency-letterbot-entry');
    if (!entryNode) return;
    const id = entryNode.dataset.entryId || '';
    const mediaType = controlsRoot?.querySelector(`[data-entry-media="${id}"]:checked`)?.value
      || entryNode.querySelector(`[data-entry-media="${id}"]:checked`)?.value
      || 'none';
    const mediaBar = controlsRoot?.querySelector('.agency-letterbot-media-bar')
      || entryNode.querySelector('.agency-letterbot-media-bar');
    const hasMedia = Boolean(controlsRoot?.querySelector('.agency-letterbot-preview') || entryNode.querySelector('.agency-letterbot-preview'));
    if (mediaBar) {
      mediaBar.classList.toggle('is-active', Boolean(mediaType) || hasMedia);
    }
    (controlsRoot || entryNode).querySelectorAll('.agency-letterbot-media-chip').forEach(chip => {
      const input = chip.querySelector('input[type="radio"]');
      chip.classList.toggle('is-selected', Boolean(input?.checked));
    });
    const uploadBtn = (controlsRoot || entryNode).querySelector('[data-entry-upload]');
    if (uploadBtn) uploadBtn.classList.toggle('is-selected', hasMedia);
  }

  function openPreviewModal() {
    const entry = ensureSingleLetterEntry();
    const text = entriesRoot?.querySelector(`[data-entry-text="${entry.id}"]`)?.value || entry.text || '';
    if (!previewModal || !previewBody) return;

    let html = '';
    if (entry.mediaType === 'photo' && entry.hasMedia && entry.mediaUrl) {
      html = `<img class="agency-letterbot-preview-large" src="${escapeHtml(entry.mediaUrl)}" alt="">`;
    } else if (entry.mediaType === 'video' && entry.hasMedia && entry.mediaUrl) {
      html = `<video class="agency-letterbot-preview-large" src="${escapeHtml(entry.mediaUrl)}" controls autoplay></video>`;
    } else {
      html = `<div class="agency-letterbot-preview-text">${formatLetterTextHtml(text)}</div>`;
    }

    previewBody.innerHTML = html;
    previewModal.classList.remove('hidden');
    previewModal.setAttribute('aria-hidden', 'false');
  }

  function closePreviewModal() {
    previewModal?.classList.add('hidden');
    previewModal?.setAttribute('aria-hidden', 'true');
    if (previewBody) previewBody.innerHTML = '';
  }

  function startCountdownTimer() {
    if (letterBotCountdownTimer) clearInterval(letterBotCountdownTimer);
    letterBotCountdownTimer = window.setInterval(updateLetterBotStatus, 1000);
  }

  function stopLetterBotPoll() {
    if (letterBotPollTimer) clearInterval(letterBotPollTimer);
    letterBotPollTimer = null;
  }

  function startLetterBotPoll() {
    stopLetterBotPoll();
    if (!letterBotState?.enabled) return;
    letterBotPollTimer = window.setInterval(() => {
      if (!letterBotState?.enabled) {
        stopLetterBotPoll();
        return;
      }
      apiLetterBot('GET')
        .then(result => {
          letterBotState = result.letterbot || letterBotState;
          updateLetterBotStatus();
        })
        .catch(() => {});
    }, 5000);
  }

  async function readVideoDuration(file) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        const duration = Number(video.duration || 0);
        URL.revokeObjectURL(video.src);
        resolve(duration);
      };
      video.onerror = () => {
        URL.revokeObjectURL(video.src);
        reject(new Error('Could not read video metadata'));
      };
      video.src = URL.createObjectURL(file);
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsDataURL(file);
    });
  }

  function ensureSingleLetterEntry() {
    const entries = Array.isArray(letterBotState?.entries) ? letterBotState.entries.slice(0, 1) : [];
    if (!entries.length) {
      entries.push({
        id: crypto.randomUUID(),
        text: '',
        mediaType: 'none',
        mediaName: '',
        hasMedia: false,
        mediaUrl: ''
      });
    }
    letterBotState = { ...(letterBotState || {}), entries };
    return entries[0];
  }

  function wireEntryInteractions() {
    const entryNode = entriesRoot?.querySelector('.agency-letterbot-entry');
    if (!entryNode) return;
    const id = entryNode.dataset.entryId || '';
    const mediaRoot = controlsRoot || entryNode;

    mediaRoot.querySelectorAll(`[data-entry-media="${id}"]`).forEach(input => {
      input.addEventListener('change', syncMediaBarGlow);
    });

    mediaRoot.querySelectorAll('[data-preview-open]').forEach(node => {
      node.addEventListener('click', event => {
        if (event.target.closest('[data-entry-upload]')) return;
        openPreviewModal();
      });
    });

    const textarea = entryNode.querySelector(`[data-entry-text="${id}"]`);
    if (textarea) {
      textarea.addEventListener('input', () => syncLetterTextHighlight(id));
      textarea.addEventListener('scroll', () => syncLetterTextHighlight(id));
      syncLetterTextHighlight(id);
    }

    syncMediaBarGlow();
  }

  function renderLetterBotControls(entry) {
    if (!controlsRoot) return;
    controlsRoot.innerHTML = `
      <div class="agency-letterbot-media-bar is-active" data-preview-open>
        <label class="agency-letterbot-media-chip ${entry.mediaType === 'none' ? 'is-selected' : ''}">
          <input type="radio" name="media-${escapeHtml(entry.id)}" value="none" data-entry-media="${escapeHtml(entry.id)}" ${entry.mediaType === 'none' ? 'checked' : ''}>
          <span>Text only</span>
        </label>
        <label class="agency-letterbot-media-chip ${entry.mediaType === 'photo' ? 'is-selected' : ''}">
          <input type="radio" name="media-${escapeHtml(entry.id)}" value="photo" data-entry-media="${escapeHtml(entry.id)}" ${entry.mediaType === 'photo' ? 'checked' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10.5" r="1.5"/><path d="m3 16 5-5 4 4 3-3 6 6"/></svg>
          <span>Photo</span>
        </label>
        <label class="agency-letterbot-media-chip ${entry.mediaType === 'video' ? 'is-selected' : ''}">
          <input type="radio" name="media-${escapeHtml(entry.id)}" value="video" data-entry-media="${escapeHtml(entry.id)}" ${entry.mediaType === 'video' ? 'checked' : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="6" width="14" height="12" rx="2"/><path d="M17 10l4-2v8l-4-2"/></svg>
          <span>Video</span>
        </label>
        <input type="file" class="agency-letterbot-file hidden" data-entry-file="${escapeHtml(entry.id)}" accept="${entry.mediaType === 'video' ? 'video/mp4' : 'image/jpeg,image/png,image/webp'}">
        <button type="button" class="agency-letterbot-upload ${entry.hasMedia ? 'is-selected' : ''}" data-entry-upload="${escapeHtml(entry.id)}">${entry.hasMedia ? escapeHtml(entry.mediaName || 'Change file') : 'Choose file'}</button>
        ${entry.hasMedia && entry.mediaType === 'photo' && entry.mediaUrl ? `<button type="button" class="agency-letterbot-preview-btn" data-preview-open><img class="agency-letterbot-preview" src="${escapeHtml(entry.mediaUrl)}" alt=""></button>` : ''}
        ${entry.hasMedia && entry.mediaType === 'video' && entry.mediaUrl ? `<button type="button" class="agency-letterbot-preview-btn" data-preview-open><video class="agency-letterbot-preview" src="${escapeHtml(entry.mediaUrl)}" muted></video></button>` : ''}
      </div>
    `;
  }

  function renderLetterBotEntries() {
    if (!entriesRoot) return;
    const entry = ensureSingleLetterEntry();
    entriesRoot.innerHTML = `
      <article class="agency-letterbot-entry" data-entry-id="${escapeHtml(entry.id)}">
        <div class="agency-letterbot-text-wrap">
          <div class="agency-letterbot-text-highlight" data-entry-highlight="${escapeHtml(entry.id)}" aria-hidden="true"></div>
          <textarea class="agency-letterbot-text" data-entry-text="${escapeHtml(entry.id)}" placeholder="Write your mailing message here...">${escapeHtml(entry.text || '')}</textarea>
        </div>
      </article>
    `;
    renderLetterBotControls(entry);
    wireEntryInteractions();
  }

  function collectEntriesFromDom() {
    const node = entriesRoot?.querySelector('.agency-letterbot-entry');
    if (!node) return [];
    const id = node.dataset.entryId || '';
    const text = node.querySelector(`[data-entry-text="${id}"]`)?.value || '';
    const mediaType = (controlsRoot || node).querySelector(`[data-entry-media="${id}"]:checked`)?.value || 'none';
    const existing = (letterBotState?.entries || []).find(item => item.id === id);
    return [{
      id,
      text,
      mediaType,
      mediaName: existing?.mediaName || '',
      mediaMime: existing?.mediaMime || '',
      hasMedia: existing?.hasMedia || false,
      mediaUrl: existing?.mediaUrl || ''
    }];
  }

  async function apiLetterBot(method, suffix = '', body = null) {
    const profileId = activeProfileId();
    if (!profileId) throw new Error('Choose a profile first');
    const response = await fetch(`/api/profiles/${encodeURIComponent(profileId)}/letterbot${suffix}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'LetterBot request failed');
    return result;
  }

  async function loadLetterBotPanel() {
    if (!syncLetterBotAccess()) return;
    const profileId = activeProfileId();
    if (!profileId) return;
    try {
      const health = await fetch('/api/health').then(r => r.json()).catch(() => ({}));
      letterBotBuildId = String(health?.letterBotBuild || '');
      const result = await apiLetterBot('GET');
      letterBotState = result.letterbot || null;
      if (intervalInput && letterBotState) intervalInput.value = String(letterBotState.intervalMinutes || 20);
      renderLetterBotEntries();
      updateLetterBotStatus();
      startCountdownTimer();
      startLetterBotPoll();
    } catch (error) {
      if (errorEl) {
        errorEl.textContent = error.message || 'Could not load LetterBot';
        errorEl.classList.remove('hidden');
      }
    }
  }

  async function saveLetterBotConfig() {
    const entries = collectEntriesFromDom();
    const result = await apiLetterBot('PUT', '', {
      intervalMinutes: Number(intervalInput?.value || 20) || 20,
      entries: entries.map(entry => ({
        id: entry.id,
        text: entry.text,
        mediaType: entry.mediaType
      }))
    });
    letterBotState = result.letterbot;
    renderLetterBotEntries();
    updateLetterBotStatus();
  }

  async function clearLetter() {
    if (letterBotState?.enabled) {
      alert('Stop mailing before deleting the letter');
      return;
    }
    if (!window.confirm('Delete this letter and attached media?')) return;
    const result = await apiLetterBot('POST', '/clear');
    letterBotState = result.letterbot;
    renderLetterBotEntries();
    updateLetterBotStatus();
  }

  async function uploadEntryMedia(entryId, file, mediaType) {
    if (!file) return;
    if (mediaType === 'video') {
      if (file.type !== 'video/mp4') throw new Error('Use MP4 video only');
      const duration = await readVideoDuration(file);
      if (duration > 3.05) throw new Error('Dream Singles allows videos up to 3 seconds only');
      const dataUrl = await readFileAsDataUrl(file);
      await fetch(`/api/profiles/${encodeURIComponent(activeProfileId())}/letterbot/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entryId,
          mediaType: 'video',
          dataUrl,
          name: file.name,
          durationSec: duration
        })
      }).then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not upload video');
      });
    } else {
      if (!/^image\/(jpeg|jpg|png|webp)$/i.test(file.type)) throw new Error('Use JPG, PNG or WebP photo');
      const dataUrl = await readFileAsDataUrl(file);
      await fetch(`/api/profiles/${encodeURIComponent(activeProfileId())}/letterbot/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entryId,
          mediaType: 'photo',
          dataUrl,
          name: file.name
        })
      }).then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not upload photo');
      });
    }
    await saveLetterBotConfig();
    await loadLetterBotPanel();
  }

  controlsRoot?.addEventListener('click', async event => {
    const uploadBtn = event.target.closest('[data-entry-upload]');
    if (uploadBtn) {
      event.stopPropagation();
      const id = uploadBtn.dataset.entryUpload || '';
      const mediaType = controlsRoot.querySelector(`[data-entry-media="${id}"]:checked`)?.value || 'none';
      if (mediaType === 'none') {
        alert('Choose Photo or Video first');
        return;
      }
      const input = controlsRoot.querySelector(`[data-entry-file="${id}"]`);
      if (!input) return;
      input.accept = mediaType === 'video' ? 'video/mp4' : 'image/jpeg,image/png,image/webp';
      input.onchange = async () => {
        const file = input.files?.[0];
        input.value = '';
        if (!file) return;
        try {
          uploadBtn.disabled = true;
          await saveLetterBotConfig();
          await uploadEntryMedia(id, file, mediaType);
        } catch (error) {
          alert(error.message || 'Could not upload file');
        } finally {
          uploadBtn.disabled = false;
        }
      };
      input.click();
      return;
    }

    if (event.target.closest('[data-preview-open]')) {
      openPreviewModal();
    }
  });

  previewCloseBtn?.addEventListener('click', closePreviewModal);
  previewModal?.querySelectorAll('[data-preview-close]').forEach(node => {
    node.addEventListener('click', closePreviewModal);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closePreviewModal();
  });

  saveBtn?.addEventListener('click', () => {
    saveBtn.disabled = true;
    saveLetterBotConfig()
      .catch(error => alert(error.message || 'Could not save'))
      .finally(() => { saveBtn.disabled = false; });
  });
  clearBtn?.addEventListener('click', () => {
    clearBtn.disabled = true;
    clearLetter()
      .catch(error => alert(error.message || 'Could not delete letter'))
      .finally(() => { clearBtn.disabled = false; });
  });
  startBtn?.addEventListener('click', () => {
    startBtn.disabled = true;
    saveLetterBotConfig()
      .then(() => apiLetterBot('POST', '/start'))
      .then(result => {
        letterBotState = result.letterbot;
        renderLetterBotEntries();
        updateLetterBotStatus();
        startLetterBotPoll();
      })
      .catch(error => alert(error.message || 'Could not start LetterBot'))
      .finally(() => { startBtn.disabled = false; });
  });
  stopBtn?.addEventListener('click', () => {
    stopBtn.disabled = true;
    apiLetterBot('POST', '/stop')
      .then(result => {
        letterBotState = result.letterbot;
        updateLetterBotStatus();
        stopLetterBotPoll();
      })
      .catch(error => alert(error.message || 'Could not stop LetterBot'))
      .finally(() => { stopBtn.disabled = false; });
  });
  sendNowBtn?.addEventListener('click', () => {
    sendNowBtn.disabled = true;
    saveLetterBotConfig()
      .then(() => apiLetterBot('POST', '/send-now'))
      .then(result => {
        letterBotState = result.letterbot;
        renderLetterBotEntries();
        updateLetterBotStatus();
      })
      .catch(error => alert(error.message || 'Could not send letter'))
      .finally(() => { sendNowBtn.disabled = false; });
  });
  window.syncAgencyLetterBotAccess = syncLetterBotAccess;
  window.loadAgencyLetterBotPanel = loadLetterBotPanel;
})();
