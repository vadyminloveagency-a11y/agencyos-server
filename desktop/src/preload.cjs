const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agencyElectron', {
  prepareDreamProfile: profileId => ipcRenderer.invoke('agency:prepare-dream-profile', profileId),
  logoutDreamProfile: profileId => ipcRenderer.invoke('agency:logout-dream-profile', profileId),
  openDreamUrl: (profileId, url) => ipcRenderer.invoke('agency:open-dream-url', { profileId, url }),
  openExternalUrl: url => ipcRenderer.invoke('agency:open-external-url', url),
  navigate: command => ipcRenderer.invoke('agency:navigate', command),
  checkForUpdates: () => ipcRenderer.invoke('agency:check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('agency:install-update'),
  openDevTools: () => ipcRenderer.invoke('agency:open-devtools'),
  getDesktopInfo: () => ipcRenderer.invoke('agency:get-desktop-info'),
  letterBotStart: profileId => ipcRenderer.invoke('agency:letterbot-start', profileId),
  letterBotStop: profileId => ipcRenderer.invoke('agency:letterbot-stop', profileId),
  letterBotSendNow: profileId => ipcRenderer.invoke('agency:letterbot-send-now', profileId),
  letterBotStatus: profileId => ipcRenderer.invoke('agency:letterbot-status', profileId)
});
