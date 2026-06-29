(() => {
  const panel = document.querySelector('[data-agency-panel="letterbot"]');
  if (!panel) return;

  const noAccess = document.getElementById('agencyLetterBotNoAccess');
  const content = document.getElementById('agencyLetterBotContent');
  const authorizeBtn = document.getElementById('agencyLetterBotAuthorizeBtn');
  const statusEl = document.getElementById('agencyLetterBotStatus');
  const sentCountEl = document.getElementById('agencyLetterBotSentCount');
  const buildEl = document.getElementById('agencyLetterBotBuild');
  const countdownEl = document.getElementById('agencyLetterBotCountdown');
  const intervalInput = document.getElementById('agencyLetterBotInterval');
  const entriesRoot = document.getElementById('agencyLetterBotEntries');
  const addBtn = document.getElementById('agencyLetterBotAddEntry');
  const saveBtn = document.getElementById('agencyLetterBotSaveBtn');
  const startBtn = document.getElementById('agencyLetterBotStartBtn');
  const stopBtn = document.getElementById('agencyLetterBotStopBtn');
  const sendNowBtn = document.getElementById('agencyLetterBotSendNowBtn');

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
    if (ms <= 0) return 'Sending soon...';
    const totalSec = Math.ceil(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${String(sec).padStart(2, '0')}`;
  }

  function updateLetterBotStatus() {
    if (!letterBotState) return;
    const parts = [];
    if (letterBotState.enabled) parts.push('Running');
    else parts.push('Stopped');
    if (letterBotState.lastSuccessAt) parts.push(`Last sent: ${new Date(letterBotState.lastSuccessAt).toLocaleString()}`);
    else if (letterBotState.lastTemplateAt) parts.push(`Template saved: ${new Date(letterBotState.lastTemplateAt).toLocaleString()}`);
    if (letterBotState.lastError) parts.push(`Error: ${letterBotState.lastError}`);
    if (statusEl) statusEl.textContent = parts.join(' · ');
    if (sentCountEl) {
      const session = Number(letterBotState.menSentSession) || 0;
      const today = Number(letterBotState.menSentToday) || 0;
      sentCountEl.textContent = `Men processed: ${session} (session) · ${today} (today)`;
    }
    if (countdownEl) countdownEl.textContent = letterBotState.enabled
      ? `Sending every ~10 sec · Next template: ${formatCountdown(letterBotState.nextRunAt)}`
      : 'LetterBot is stopped';
    if (buildEl) {
      const build = letterBotState.buildId || letterBotBuildId || '';
      const stale = build !== '20260629-2';
      buildEl.textContent = stale
        ? `Build ${build || 'old'} · update pending — redeploy Render and hard-refresh (Ctrl+Shift+R)`
        : `Build ${build}`;
      buildEl.classList.toggle('is-stale', stale);
    }
    if (startBtn) startBtn.disabled = letterBotState.enabled;
    if (stopBtn) stopBtn.disabled = !letterBotState.enabled;
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

  function renderLetterBotEntries() {
    if (!entriesRoot) return;
    const entries = Array.isArray(letterBotState?.entries) ? letterBotState.entries : [];
    if (!entries.length) {
      entriesRoot.innerHTML = '<div class="agency-letterbot-empty">Add your first letter template below.</div>';
      return;
    }
    entriesRoot.innerHTML = entries.map((entry, index) => `
      <article class="agency-letterbot-entry" data-entry-id="${escapeHtml(entry.id)}">
        <div class="agency-letterbot-entry-head">
          <strong>Letter ${index + 1}</strong>
          <button type="button" class="agency-letterbot-remove" data-remove-entry="${escapeHtml(entry.id)}">Remove</button>
        </div>
        <textarea class="agency-letterbot-text" data-entry-text="${escapeHtml(entry.id)}" rows="5" placeholder="Letter text for Dream Letter Sendout Tool">${escapeHtml(entry.text || '')}</textarea>
        <div class="agency-letterbot-media-row">
          <label class="agency-letterbot-media-option">
            <input type="radio" name="media-${escapeHtml(entry.id)}" value="none" data-entry-media="${escapeHtml(entry.id)}" ${entry.mediaType === 'none' ? 'checked' : ''}>
            <span>No media</span>
          </label>
          <label class="agency-letterbot-media-option">
            <input type="radio" name="media-${escapeHtml(entry.id)}" value="photo" data-entry-media="${escapeHtml(entry.id)}" ${entry.mediaType === 'photo' ? 'checked' : ''}>
            <span>Photo</span>
          </label>
          <label class="agency-letterbot-media-option">
            <input type="radio" name="media-${escapeHtml(entry.id)}" value="video" data-entry-media="${escapeHtml(entry.id)}" ${entry.mediaType === 'video' ? 'checked' : ''}>
            <span>Video (max 3 sec)</span>
          </label>
          <input type="file" class="agency-letterbot-file hidden" data-entry-file="${escapeHtml(entry.id)}" accept="${entry.mediaType === 'video' ? 'video/mp4' : 'image/jpeg,image/png,image/webp'}">
          <button type="button" class="agency-letterbot-upload" data-entry-upload="${escapeHtml(entry.id)}">${entry.hasMedia ? escapeHtml(entry.mediaName || 'Change file') : 'Choose file'}</button>
          ${entry.hasMedia && entry.mediaType === 'photo' && entry.mediaUrl ? `<img class="agency-letterbot-preview" src="${escapeHtml(entry.mediaUrl)}" alt="">` : ''}
          ${entry.hasMedia && entry.mediaType === 'video' && entry.mediaUrl ? `<video class="agency-letterbot-preview" src="${escapeHtml(entry.mediaUrl)}" controls></video>` : ''}
        </div>
      </article>
    `).join('');
  }

  function collectEntriesFromDom() {
    const entries = [];
    entriesRoot?.querySelectorAll('.agency-letterbot-entry').forEach(node => {
      const id = node.dataset.entryId || '';
      const text = node.querySelector(`[data-entry-text="${id}"]`)?.value || '';
      const mediaType = node.querySelector(`[data-entry-media="${id}"]:checked`)?.value || 'none';
      const existing = (letterBotState?.entries || []).find(item => item.id === id);
      entries.push({
        id,
        text,
        mediaType,
        mediaName: existing?.mediaName || '',
        mediaMime: existing?.mediaMime || '',
        hasMedia: existing?.hasMedia || false,
        mediaUrl: existing?.mediaUrl || ''
      });
    });
    return entries;
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
      if (statusEl) statusEl.textContent = error.message || 'Could not load LetterBot';
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
    if (statusEl) statusEl.textContent = 'Saved';
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

  function addEntry() {
    const entries = collectEntriesFromDom();
    entries.push({
      id: crypto.randomUUID(),
      text: '',
      mediaType: 'none',
      mediaName: '',
      hasMedia: false,
      mediaUrl: ''
    });
    letterBotState = { ...(letterBotState || {}), entries };
    renderLetterBotEntries();
  }

  entriesRoot?.addEventListener('click', async event => {
    const removeBtn = event.target.closest('[data-remove-entry]');
    if (removeBtn) {
      const id = removeBtn.dataset.removeEntry || '';
      const entries = collectEntriesFromDom().filter(entry => entry.id !== id);
      letterBotState = { ...(letterBotState || {}), entries };
      await apiLetterBot('PUT', '', {
        intervalMinutes: Number(intervalInput?.value || 20) || 20,
        entries
      }).catch(() => {});
      if (id) {
        await fetch(`/api/profiles/${encodeURIComponent(activeProfileId())}/letterbot/media/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
      }
      await loadLetterBotPanel();
      return;
    }
    const uploadBtn = event.target.closest('[data-entry-upload]');
    if (uploadBtn) {
      const id = uploadBtn.dataset.entryUpload || '';
      const mediaType = entriesRoot.querySelector(`[data-entry-media="${id}"]:checked`)?.value || 'none';
      if (mediaType === 'none') {
        alert('Choose Photo or Video first');
        return;
      }
      const input = entriesRoot.querySelector(`[data-entry-file="${id}"]`);
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
    }
  });

  addBtn?.addEventListener('click', addEntry);
  saveBtn?.addEventListener('click', () => {
    saveBtn.disabled = true;
    saveLetterBotConfig()
      .catch(error => alert(error.message || 'Could not save'))
      .finally(() => { saveBtn.disabled = false; });
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
