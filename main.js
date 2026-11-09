const { app, BrowserWindow, ipcMain, safeStorage, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { getSpotifyState, controlSpotify, seekSpotify } = require('./src/spotify');
const { fetchLyrics } = require('./src/lyrics');
const { createCoach } = require('./src/coach');

let mainWindow;

function configPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

async function loadSettings() {
  try {
    const stored = JSON.parse(await fs.readFile(configPath(), 'utf8'));
    if (stored.encryptedApiKey && safeStorage.isEncryptionAvailable()) {
      stored.apiKey = safeStorage.decryptString(Buffer.from(stored.encryptedApiKey, 'base64'));
    }
    delete stored.encryptedApiKey;
    return { model: 'gpt-4o-mini', targetLanguage: 'Hindi', ...stored };
  } catch {
    return { model: 'gpt-4o-mini', targetLanguage: 'Hindi', apiKey: '' };
  }
}

async function saveSettings(next) {
  const value = {
    model: String(next.model || 'gpt-4o-mini').trim(),
    targetLanguage: String(next.targetLanguage || 'Hindi').trim(),
  };
  if (next.apiKey && safeStorage.isEncryptionAvailable()) {
    value.encryptedApiKey = safeStorage.encryptString(String(next.apiKey).trim()).toString('base64');
  }
  await fs.mkdir(path.dirname(configPath()), { recursive: true });
  await fs.writeFile(configPath(), JSON.stringify(value, null, 2));
  return { ...value, apiKey: next.apiKey ? 'saved' : '' };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1040,
    minHeight: 680,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 17 },
    backgroundColor: '#10100f',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

app.whenReady().then(() => {
  ipcMain.handle('spotify:state', () => getSpotifyState());
  ipcMain.handle('spotify:control', (_event, action) => controlSpotify(action));
  ipcMain.handle('spotify:seek', (_event, positionMs) => seekSpotify(positionMs));
  ipcMain.handle('lyrics:fetch', (_event, track) => fetchLyrics(track));
  ipcMain.handle('coach:analyze', async (_event, payload) => {
    const settings = await loadSettings();
    const apiKey = settings.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('Add an OpenAI API key in Settings to translate and explain this song.');
    return createCoach({ ...settings, apiKey }).analyze(payload);
  });
  ipcMain.handle('settings:load', loadSettings);
  ipcMain.handle('settings:save', (_event, settings) => saveSettings(settings));
  ipcMain.handle('external:open', (_event, url) => shell.openExternal(url));
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
