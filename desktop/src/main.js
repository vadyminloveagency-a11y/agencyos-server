import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { DreamProfileManager } from './dream-profiles.js';
import { LetterBotRunner } from './letterbot-runner.js';
import { openAgencyContentWindow } from './content-windows.js';
import { readConfig, resolveServerUrl, writeConfig, pickWorkingServerUrl, DEFAULT_SERVER_URL } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_VERSION = '0.3.0';
const isDev = process.argv.includes('--dev');

let mainWindow = null;
let dreamProfiles = null;
let letterBotRunner = null;
let serverUrl = resolveServerUrl();

function crmUrl() {
  const base = serverUrl.replace(/\/+$/, '');
  return `${base}/?desktopVersion=${encodeURIComponent(APP_VERSION)}`;
}

function showLoadError(targetUrl, message) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>AgencyOS</title>
<style>body{font-family:Segoe UI,sans-serif;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{max-width:520px;padding:28px;border:1px solid #333;border-radius:12px;background:#1a1a1a}
h1{margin:0 0 12px;font-size:22px}p{line-height:1.5;color:#ccc}a{color:#7cc4ff}</style></head><body>
<div class="box"><h1>AgencyOS could not load</h1>
<p>${message}</p><p>Server: <code>${targetUrl}</code></p>
<p>Check internet connection or try again in a minute.</p></div></body></html>`;
  mainWindow?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

async function loadCrm() {
  const targetUrl = crmUrl();
  try {
    await mainWindow.loadURL(targetUrl);
  } catch (error) {
    showLoadError(targetUrl, error.message || 'Could not open CRM URL');
  }
}

async function getActiveProfileIdFromCrm() {
  if (!mainWindow || mainWindow.isDestroyed()) return '';
  try {
    return await mainWindow.webContents.executeJavaScript(
      `(() => {
        try {
          return String(localStorage.getItem('dream_crm_profile_id') || '').trim();
        } catch {
          return '';
        }
      })()`,
      true
    );
  } catch {
    return '';
  }
}

async function handleWindowOpenUrl(url) {
  const target = String(url || '').trim();
  if (!target) return;
  if (/^https:\/\/([^/]+\.)?dream-singles\.com\//i.test(target)) {
    const profileId = dreamProfiles?.lastProfileId || await getActiveProfileIdFromCrm();
    if (profileId && dreamProfiles) {
      try {
        await dreamProfiles.openDreamUrl(profileId, target);
      } catch (error) {
        console.warn('[AgencyOS] Could not open Dream URL in background window:', error?.message || error);
      }
      return;
    }
    openAgencyContentWindow(target);
    return;
  }
  if (/^https?:\/\//i.test(target)) {
    openAgencyContentWindow(target);
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    title: 'AgencyOS',
    autoHideMenuBar: !isDev,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  dreamProfiles = new DreamProfileManager({
    serverUrl,
    authSession: mainWindow.webContents.session
  });
  letterBotRunner = new LetterBotRunner({
    dreamProfiles,
    authSession: mainWindow.webContents.session,
    serverUrl
  });

  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('[AgencyOS] preload failed:', preloadPath, error?.message || error);
  });

  mainWindow.webContents.on('did-fail-load', (_event, code, description, validatedURL) => {
    if (validatedURL.startsWith('data:')) return;
    showLoadError(validatedURL || crmUrl(), `${description || 'Load failed'} (${code})`);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    handleWindowOpenUrl(url);
    return { action: 'deny' };
  });

  loadCrm();
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpcHandlers() {
  ipcMain.handle('agency:prepare-dream-profile', async (_event, profileId) => {
    try {
      return await dreamProfiles.prepareDreamProfile(profileId);
    } catch (error) {
      return { ok: false, error: error.message || 'Could not prepare Dream profile' };
    }
  });

  ipcMain.handle('agency:logout-dream-profile', async (_event, profileId) => {
    try {
      return await dreamProfiles.logoutDreamProfile(profileId);
    } catch (error) {
      return { ok: false, error: error.message || 'Could not logout Dream profile' };
    }
  });

  ipcMain.handle('agency:open-dream-url', async (_event, payload = {}) => {
    try {
      return await dreamProfiles.openDreamUrl(payload.profileId, payload.url);
    } catch (error) {
      return { ok: false, error: error.message || 'Could not open Dream URL' };
    }
  });

  ipcMain.handle('agency:open-external-url', async (_event, url) => {
    try {
      return openAgencyContentWindow(url);
    } catch (error) {
      return { ok: false, error: error.message || 'Could not open link' };
    }
  });

  ipcMain.handle('agency:navigate', async (_event, command) => {
    if (!mainWindow) return { ok: false };
    const action = String(command || '');
    if (action === 'zoom-in' || action === 'zoom-out') {
      const current = mainWindow.webContents.getZoomFactor();
      const next = action === 'zoom-in'
        ? Math.min(1.5, current + 0.1)
        : Math.max(0.75, current - 0.1);
      mainWindow.webContents.setZoomFactor(next);
      return { ok: true, zoom: next };
    }
    return { ok: false, error: 'Unsupported navigation command' };
  });

  ipcMain.handle('agency:check-for-updates', async () => ({
    ok: true,
    available: false,
    version: APP_VERSION
  }));

  ipcMain.handle('agency:install-update', async () => ({
    ok: false,
    error: 'Auto-update will be enabled in the next desktop release'
  }));

  ipcMain.handle('agency:open-devtools', async () => {
    mainWindow?.webContents.openDevTools({ mode: 'detach' });
    return { ok: true };
  });

  ipcMain.handle('agency:get-desktop-info', async () => ({
    ok: true,
    version: APP_VERSION,
    serverUrl,
    letterBot: true
  }));

  ipcMain.handle('agency:letterbot-start', async (_event, profileId) => {
    try {
      const letterbot = await letterBotRunner.start(profileId);
      return { ok: true, letterbot };
    } catch (error) {
      return { ok: false, error: error.message || 'Could not start LetterBot' };
    }
  });

  ipcMain.handle('agency:letterbot-stop', async (_event, profileId) => {
    try {
      const letterbot = await letterBotRunner.stop(profileId);
      return { ok: true, letterbot };
    } catch (error) {
      return { ok: false, error: error.message || 'Could not stop LetterBot' };
    }
  });

  ipcMain.handle('agency:letterbot-send-now', async (_event, profileId) => {
    try {
      const letterbot = await letterBotRunner.sendNow(profileId);
      return { ok: true, letterbot };
    } catch (error) {
      return { ok: false, error: error.message || 'Could not send letter' };
    }
  });

  ipcMain.handle('agency:letterbot-status', async (_event, profileId) => {
    try {
      const letterbot = await letterBotRunner.status(profileId);
      return { ok: true, letterbot };
    } catch (error) {
      return { ok: false, error: error.message || 'Could not load LetterBot status' };
    }
  });
}

app.whenReady().then(async () => {
  const saved = readConfig(app.getPath('userData'));
  const preferred = saved.serverUrl || resolveServerUrl();
  serverUrl = await pickWorkingServerUrl(preferred);
  writeConfig(app.getPath('userData'), { serverUrl });
  registerIpcHandlers();
  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
