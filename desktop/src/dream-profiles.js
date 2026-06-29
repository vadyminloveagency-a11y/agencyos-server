import { BrowserWindow, session, shell } from 'electron';
import { apiRequest } from './server-api.js';

const DREAM_HOME_URL = 'https://www.dream-singles.com/members/messaging/inbox';

function profilePartition(profileId) {
  return `persist:agencyos-profile-${String(profileId || '').trim()}`;
}

async function applyDreamCookies(electronSession, cookies = []) {
  const url = 'https://www.dream-singles.com/';
  for (const cookie of cookies) {
    if (!cookie?.name) continue;
    await electronSession.cookies.set({
      url,
      name: String(cookie.name),
      value: String(cookie.value ?? ''),
      domain: '.dream-singles.com',
      path: '/',
      secure: true,
      sameSite: 'lax'
    });
  }
}

export class DreamProfileManager {
  constructor(options) {
    this.serverUrl = options.serverUrl;
    this.authSession = options.authSession;
    this.windows = new Map();
    this.lastProfileId = '';
  }

  getProfileSession(profileId) {
    return session.fromPartition(profilePartition(profileId));
  }

  async launchProfile(profileId) {
    const launch = await apiRequest(
      this.authSession,
      this.serverUrl,
      `/api/profiles/${encodeURIComponent(profileId)}/launch`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      }
    );
    const redeem = await apiRequest(
      this.authSession,
      this.serverUrl,
      '/api/profiles/launch/redeem',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: launch.token })
      }
    );
    return redeem;
  }

  async prepareDreamProfile(profileId) {
    const id = String(profileId || '').trim();
    if (!id) throw new Error('Profile id is required');
    const profileSession = this.getProfileSession(id);
    try {
      await profileSession.clearStorageData();
    } catch {}
    const redeem = await this.launchProfile(id);
    const cookies = Array.isArray(redeem.dreamCookies) ? redeem.dreamCookies : [];
    if (!cookies.length) {
      throw new Error('Dream auto-login failed. Update login and password for this profile in Admin and press Sync Dream.');
    }
    await applyDreamCookies(profileSession, cookies);
    const window = this.ensureWindow(id);
    window.setTitle(`Dream Singles · ${redeem.profileId || id}`);
    await window.loadURL(DREAM_HOME_URL);
    this.lastProfileId = id;
    return { ok: true, profileId: id };
  }

  ensureWindow(profileId) {
    const id = String(profileId || '').trim();
    const existing = this.windows.get(id);
    if (existing && !existing.isDestroyed()) {
      existing.show();
      existing.focus();
      return existing;
    }
    const profileSession = this.getProfileSession(id);
    const window = new BrowserWindow({
      width: 1280,
      height: 860,
      title: `Dream Singles · ${id}`,
      autoHideMenuBar: true,
      webPreferences: {
        partition: profilePartition(id),
        session: profileSession,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    window.webContents.setWindowOpenHandler(({ url: openUrl }) => {
      const target = String(openUrl || '').trim();
      if (/^https:\/\/([^/]+\.)?dream-singles\.com\//i.test(target)) {
        window.loadURL(target).catch(() => {});
        return { action: 'deny' };
      }
      if (/^https?:\/\//i.test(target)) {
        shell.openExternal(target).catch(() => {});
      }
      return { action: 'deny' };
    });
    window.on('closed', () => {
      if (this.windows.get(id) === window) this.windows.delete(id);
    });
    this.windows.set(id, window);
    return window;
  }

  async openDreamUrl(profileId, url) {
    const id = String(profileId || '').trim();
    const targetUrl = String(url || DREAM_HOME_URL).trim();
    if (!id) throw new Error('Profile id is required');
    const window = this.ensureWindow(id);
    await window.loadURL(targetUrl);
    window.show();
    window.focus();
    this.lastProfileId = id;
    return { ok: true, profileId: id, url: targetUrl };
  }

  async logoutDreamProfile(profileId) {
    const id = String(profileId || '').trim();
    const window = this.windows.get(id);
    if (window && !window.isDestroyed()) window.close();
    this.windows.delete(id);
    try {
      await this.getProfileSession(id).clearStorageData();
    } catch {}
    return { ok: true, profileId: id };
  }
}
