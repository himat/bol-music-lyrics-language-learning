const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bol', {
  spotifyState: () => ipcRenderer.invoke('spotify:state'),
  spotifyControl: (action) => ipcRenderer.invoke('spotify:control', action),
  fetchLyrics: (track) => ipcRenderer.invoke('lyrics:fetch', track),
  analyze: (payload) => ipcRenderer.invoke('coach:analyze', payload),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
});
