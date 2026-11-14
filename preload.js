const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bol', {
  spotifyState: () => ipcRenderer.invoke('spotify:state'),
  spotifyControl: (action) => ipcRenderer.invoke('spotify:control', action),
  spotifySeek: (positionMs, shouldPlay) => ipcRenderer.invoke('spotify:seek', positionMs, shouldPlay),
  spotifyPlayTrack: (spotifyUrl, positionMs) => ipcRenderer.invoke('spotify:play-track', spotifyUrl, positionMs),
  fetchLyrics: (track) => ipcRenderer.invoke('lyrics:fetch', track),
  translate: (payload) => ipcRenderer.invoke('coach:translate', payload),
  analyze: (payload) => ipcRenderer.invoke('coach:analyze', payload),
  askCoach: (payload) => ipcRenderer.invoke('coach:chat', payload),
  listFlashcards: () => ipcRenderer.invoke('flashcards:list'),
  saveFlashcard: (payload) => ipcRenderer.invoke('flashcards:save', payload),
  generateFlashcardExamples: (payload) => ipcRenderer.invoke('flashcards:examples', payload),
  deleteFlashcard: (id) => ipcRenderer.invoke('flashcards:delete', id),
  reviewFlashcard: (id, rating) => ipcRenderer.invoke('flashcards:review', id, rating),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
});
