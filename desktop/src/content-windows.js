import { BrowserWindow } from 'electron';

const MATERIAL_PARTITION = 'persist:agencyos-material';
const windowsByKey = new Map();

function windowKey(url) {
  try {
    const parsed = new URL(url);
    if (/([a-z0-9-]+\.)?google\.com$/i.test(parsed.hostname)) {
      return 'google-material';
    }
    return parsed.origin;
  } catch {
    return String(url || '').trim();
  }
}

function windowTitle(url) {
  try {
    const host = new URL(url).hostname;
    if (/drive\.google\.com/i.test(host)) return 'Google Drive';
    if (/docs\.google\.com/i.test(host)) return 'Google Docs';
    return host;
  } catch {
    return 'AgencyOS';
  }
}

export function openAgencyContentWindow(url, options = {}) {
  const target = String(url || '').trim();
  if (!/^https?:\/\//i.test(target)) {
    throw new Error('Invalid URL');
  }
  const key = options.key || windowKey(target);
  const existing = windowsByKey.get(key);
  if (existing && !existing.isDestroyed()) {
    existing.loadURL(target).catch(() => {});
    existing.show();
    existing.focus();
    return { ok: true, url: target, reused: true };
  }
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: options.title || windowTitle(target),
    autoHideMenuBar: true,
    webPreferences: {
      partition: MATERIAL_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.webContents.setWindowOpenHandler(({ url: openUrl }) => {
    const next = String(openUrl || '').trim();
    if (/^https?:\/\//i.test(next)) {
      openAgencyContentWindow(next);
    }
    return { action: 'deny' };
  });
  win.loadURL(target);
  windowsByKey.set(key, win);
  win.on('closed', () => {
    if (windowsByKey.get(key) === win) windowsByKey.delete(key);
  });
  return { ok: true, url: target, reused: false };
}
