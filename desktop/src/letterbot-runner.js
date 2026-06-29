import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { apiRequest, cookieHeaderForSession } from './server-api.js';
import {
  DREAM_INBOX_URL,
  sleep,
  saveLetterBotTemplate,
  openLetterBotSendPage,
  selectLetterBotOnlineFilter,
  waitForDreamSendReady,
  triggerDreamLetterSend,
  readDreamSendPageStats,
  dreamSendWasConfirmed
} from './dream-automation.js';

const SEND_TICK_MS = 10_000;
const SCHEDULER_MS = 60_000;

function pickEntry(letterbot) {
  const entries = Array.isArray(letterbot?.entries) ? letterbot.entries : [];
  const entry = entries.find(item => String(item?.text || '').trim()) || entries[0];
  if (!entry || !String(entry.text || '').trim()) return null;
  return entry;
}

function templateNextRunAt(intervalMinutes) {
  const minutes = Math.min(240, Math.max(5, Number(intervalMinutes) || 20));
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export class LetterBotRunner {
  constructor(options) {
    this.dreamProfiles = options.dreamProfiles;
    this.authSession = options.authSession;
    this.serverUrl = options.serverUrl;
    this.loops = new Map();
    this.runsInFlight = new Set();
  }

  getWebContents(profileId) {
    const id = String(profileId || '').trim();
    const window = this.dreamProfiles.windows.get(id);
    if (!window || window.isDestroyed()) {
      throw new Error('Dream window is not open. Turn profile On and wait for Dream inbox.');
    }
    return window.webContents;
  }

  api(pathname, options = {}) {
    return apiRequest(this.authSession, this.serverUrl, pathname, options);
  }

  async fetchLetterBot(profileId) {
    const result = await this.api(`/api/profiles/${encodeURIComponent(profileId)}/letterbot`);
    return result.letterbot;
  }

  async report(profileId, patch) {
    const result = await this.api(`/api/profiles/${encodeURIComponent(profileId)}/letterbot/desktop/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
    return result.letterbot;
  }

  async downloadMedia(profileId, mediaUrl) {
    const base = String(this.serverUrl || '').trim().replace(/\/+$/, '');
    const target = `${base}${mediaUrl.startsWith('/') ? mediaUrl : `/${mediaUrl}`}`;
    const cookieHeader = await cookieHeaderForSession(this.authSession, base);
    const response = await fetch(target, {
      headers: cookieHeader ? { Cookie: cookieHeader } : {}
    });
    if (!response.ok) throw new Error('Could not download letter media from server');
    const buffer = Buffer.from(await response.arrayBuffer());
    const ext = path.extname(new URL(target).pathname) || '.bin';
    const dir = path.join(app.getPath('temp'), 'agencyos-letterbot');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${String(profileId).replace(/[^a-zA-Z0-9_-]/g, '_')}-${Date.now()}${ext}`);
    fs.writeFileSync(filePath, buffer);
    return filePath;
  }

  stopLoops(profileId) {
    const id = String(profileId || '').trim();
    const state = this.loops.get(id);
    if (!state) return;
    if (state.sendTimer) clearInterval(state.sendTimer);
    if (state.schedTimer) clearInterval(state.schedTimer);
    this.loops.delete(id);
  }

  startLoops(profileId) {
    const id = String(profileId || '').trim();
    this.stopLoops(id);
    const state = { busy: false, sendTimer: null, schedTimer: null };
    state.sendTimer = setInterval(() => {
      this.tickSend(id).catch(error => console.warn(`[letterbot-desktop] ${id}: ${error.message || error}`));
    }, SEND_TICK_MS);
    state.schedTimer = setInterval(() => {
      this.tickScheduler(id).catch(error => console.warn(`[letterbot-desktop] ${id}: ${error.message || error}`));
    }, SCHEDULER_MS);
    if (state.sendTimer.unref) state.sendTimer.unref();
    if (state.schedTimer.unref) state.schedTimer.unref();
    this.loops.set(id, state);
  }

  async start(profileId) {
    const id = String(profileId || '').trim();
    const result = await this.api(`/api/profiles/${encodeURIComponent(id)}/letterbot/desktop/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    this.startLoops(id);
    this.runNow(id, { enable: true }).catch(error => {
      console.warn(`[letterbot-desktop] ${id}: ${error.message || error}`);
    });
    return result.letterbot;
  }

  async sendNow(profileId) {
    const id = String(profileId || '').trim();
    await this.api(`/api/profiles/${encodeURIComponent(id)}/letterbot/desktop/send-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    return this.runNow(id, { enable: false });
  }

  async stop(profileId) {
    const id = String(profileId || '').trim();
    this.stopLoops(id);
    const result = await this.api(`/api/profiles/${encodeURIComponent(id)}/letterbot/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    return result.letterbot;
  }

  async status(profileId) {
    return this.fetchLetterBot(profileId);
  }

  async tickSend(profileId) {
    const id = String(profileId || '').trim();
    const state = this.loops.get(id);
    if (!state || state.busy || this.runsInFlight.has(id)) return;
    const letterbot = await this.fetchLetterBot(id);
    if (!letterbot?.enabled) {
      this.stopLoops(id);
      return;
    }
    state.busy = true;
    try {
      await this.trySendOne(id, letterbot);
    } finally {
      state.busy = false;
    }
  }

  async tickScheduler(profileId) {
    const id = String(profileId || '').trim();
    if (this.runsInFlight.has(id)) return;
    const letterbot = await this.fetchLetterBot(id);
    if (!letterbot?.enabled) return;
    const now = Date.now();
    if (letterbot.nextRunAt && new Date(letterbot.nextRunAt).getTime() > now) return;
    if (!letterbot.nextRunAt && letterbot.lastTemplateAt) {
      const last = new Date(letterbot.lastTemplateAt).getTime();
      const intervalMs = Math.min(240, Math.max(5, Number(letterbot.intervalMinutes) || 20)) * 60_000;
      if (now - last < intervalMs) return;
    }
    await this.runNow(id, { enable: true, templateRefresh: true });
  }

  async trySendOne(profileId, letterbot) {
    const webContents = this.getWebContents(profileId);
    await openLetterBotSendPage(webContents).catch(() => {});
    await selectLetterBotOnlineFilter(webContents).catch(() => {});
    const ready = await waitForDreamSendReady(webContents, 5000);
    if (!ready) return null;

    const beforeStats = await readDreamSendPageStats(webContents);
    const result = await triggerDreamLetterSend(webContents);
    if (!result?.ok) return null;

    await sleep(2500);
    const afterStats = await readDreamSendPageStats(webContents);
    const confirmed = await dreamSendWasConfirmed(webContents, beforeStats, afterStats);
    if (!confirmed) return null;

    return this.report(profileId, {
      lastSuccessAt: new Date().toISOString(),
      lastError: '',
      stats: afterStats || undefined,
      menSentSession: afterStats?.sessionSent,
      menSentToday: afterStats?.dailyTotal
    });
  }

  async runNow(profileId, options = {}) {
    const id = String(profileId || '').trim();
    if (!id) throw new Error('Profile id is required');
    if (this.runsInFlight.has(id)) throw new Error('LetterBot is already running for this profile');
    this.runsInFlight.add(id);
    let tempMediaPath = '';

    try {
      const letterbot = await this.fetchLetterBot(id);
      const entry = pickEntry(letterbot);
      if (!entry) throw new Error('Add at least one letter text');

      let mediaAbsolutePath = '';
      if (entry.mediaType !== 'none') {
        if (!entry.hasMedia || !entry.mediaUrl) throw new Error('This letter requires a photo or video file');
        tempMediaPath = await this.downloadMedia(id, entry.mediaUrl);
        mediaAbsolutePath = tempMediaPath;
      }

      const webContents = this.getWebContents(id);
      await webContents.loadURL(DREAM_INBOX_URL).catch(() => {});
      await sleep(800);

      if (options.templateRefresh !== false) {
        await saveLetterBotTemplate(webContents, entry, mediaAbsolutePath);
        await this.report(id, {
          lastRunAt: new Date().toISOString(),
          lastTemplateAt: new Date().toISOString(),
          lastError: '',
          nextRunAt: templateNextRunAt(letterbot.intervalMinutes)
        });
      }

      await openLetterBotSendPage(webContents);
      await selectLetterBotOnlineFilter(webContents);
      const ready = await waitForDreamSendReady(webContents);
      if (!ready) {
        throw new Error('Dream is not ready to send letters yet. Check that the template saved and the sendout page shows Ready to begin sending.');
      }

      const beforeStats = await readDreamSendPageStats(webContents);
      const sendResult = await triggerDreamLetterSend(webContents);
      if (!sendResult?.ok) throw new Error(sendResult?.reason || 'Could not send letter on Dream');
      await sleep(2500);
      const afterStats = await readDreamSendPageStats(webContents);
      const confirmed = await dreamSendWasConfirmed(webContents, beforeStats, afterStats);
      if (!confirmed) throw new Error('Dream did not confirm the letter was sent');

      const updated = await this.report(id, {
        lastSuccessAt: new Date().toISOString(),
        lastError: '',
        stats: afterStats || undefined,
        menSentSession: afterStats?.sessionSent,
        menSentToday: afterStats?.dailyTotal
      });

      if (options.enable === true) this.startLoops(id);
      return updated;
    } catch (error) {
      await this.report(id, {
        lastRunAt: new Date().toISOString(),
        lastError: error.message || 'LetterBot failed',
        enabled: options.enable === true ? false : undefined
      }).catch(() => {});
      if (options.enable === true) this.stopLoops(id);
      throw error;
    } finally {
      this.runsInFlight.delete(id);
      if (tempMediaPath && fs.existsSync(tempMediaPath)) {
        fs.unlinkSync(tempMediaPath);
      }
    }
  }
}
