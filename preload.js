const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bol', {
  spotifyState: () => ipcRenderer.invoke('spotify:state'),
  spotifyControl: (action) => ipcRenderer.invoke('spotify:control', action),
  spotifySeek: (positionMs, shouldPlay) => ipcRenderer.invoke('spotify:seek', positionMs, shouldPlay),
  fetchLyrics: (track) => ipcRenderer.invoke('lyrics:fetch', track),
  analyze: (payload) => ipcRenderer.invoke('coach:analyze', payload),
  listFlashcards: () => ipcRenderer.invoke('flashcards:list'),
  saveFlashcard: (payload) => ipcRenderer.invoke('flashcards:save', payload),
  generateFlashcardExamples: (payload) => ipcRenderer.invoke('flashcards:examples', payload),
  deleteFlashcard: (id) => ipcRenderer.invoke('flashcards:delete', id),
  reviewFlashcard: (id, rating) => ipcRenderer.invoke('flashcards:review', id, rating),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
});
