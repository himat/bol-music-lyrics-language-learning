const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bol', {
  spotifyState: () => ipcRenderer.invoke('spotify:state'),
  spotifyControl: (action) => ipcRenderer.invoke('spotify:control', action),
  spotifySeek: (positionMs, shouldPlay) => ipcRenderer.invoke('spotify:seek', positionMs, shouldPlay),
  spotifyPlayTrack: (spotifyUrl, positionMs) => ipcRenderer.invoke('spotify:play-track', spotifyUrl, positionMs),
  fetchLyrics: (track) => ipcRenderer.invoke('lyrics:fetch', track),
  translate: (payload) => ipcRenderer.invoke('coach:translate', payload),
  onTranslationProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on('coach:translation-progress', handler);
    return () => ipcRenderer.removeListener('coach:translation-progress', handler);
  },
  analyze: (payload) => ipcRenderer.invoke('coach:analyze', payload),
  onAnalysisProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on('coach:analysis-progress', handler);
    return () => ipcRenderer.removeListener('coach:analysis-progress', handler);
  },
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
