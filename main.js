const { app, BrowserWindow, ipcMain, safeStorage, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { getSpotifyState, controlSpotify, seekSpotify } = require('./src/spotify');
const { fetchLyrics } = require('./src/lyrics');
const { createCoach } = require('./src/coach');
const { analysisCacheKey, readAnalysisCache, writeAnalysisCache } = require('./src/analysis-cache');
const { readFlashcards, upsertFlashcard, deleteFlashcard, reviewFlashcard } = require('./src/flashcards');
const { normalizeStudyState, ratingIntervals } = require('./src/spaced-repetition');

let mainWindow;
let flashcardWriteQueue = Promise.resolve();

// Keep the concise macOS menu-bar name while the packaged .app uses the
// descriptive productName configured for Finder.
app.setName('Bol');

function installApplicationMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Bol',
      submenu: [
        { role: 'about', label: 'About Bol' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: 'Hide Bol' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Bol' },
      ],
    },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { role: 'help' },
  ]));
}

function configPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function analysisCachePath() {
  return path.join(app.getPath('userData'), 'analysis-cache');
}

function flashcardsPath() {
  return path.join(app.getPath('userData'), 'flashcards.json');
}

function serializeFlashcardWrite(operation) {
  const result = flashcardWriteQueue.then(operation, operation);
  flashcardWriteQueue = result.catch(() => {});
  return result;
}

function presentFlashcard(card) {
  const study = normalizeStudyState(card.study);
  return {
    ...card,
    study,
    ratingIntervals: Object.fromEntries(Object.entries(ratingIntervals(study)).map(([rating, interval]) => [rating, interval.label])),
  };
}

function presentFlashcardResult(result) {
  return { ...result, card: presentFlashcard(result.card), cards: result.cards.map(presentFlashcard) };
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
      spellcheck: false,
      backgroundThrottling: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

app.whenReady().then(() => {
  installApplicationMenu();
  ipcMain.handle('spotify:state', () => getSpotifyState());
  ipcMain.handle('spotify:control', (_event, action) => controlSpotify(action));
  ipcMain.handle('spotify:seek', (_event, positionMs, shouldPlay) => seekSpotify(positionMs, shouldPlay));
  ipcMain.handle('lyrics:fetch', (_event, track) => fetchLyrics(track));
  ipcMain.handle('coach:analyze', async (_event, payload) => {
    const settings = await loadSettings();
    const key = analysisCacheKey({ ...payload, model: settings.model, targetLanguage: settings.targetLanguage });
    const cached = await readAnalysisCache(analysisCachePath(), key);
    if (cached) return cached;
    const apiKey = settings.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('Add an OpenAI API key in Settings to translate and explain this song.');
    const analysis = await createCoach({ ...settings, apiKey }).analyze(payload);
    await writeAnalysisCache(analysisCachePath(), key, analysis);
    return analysis;
  });
  ipcMain.handle('coach:chat', async (_event, payload) => {
    const settings = await loadSettings();
    const apiKey = settings.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('Add an OpenAI API key in Settings to ask questions about lyrics.');
    return createCoach({ ...settings, apiKey }).answerLyricQuestion(payload);
  });
  ipcMain.handle('flashcards:list', async () => (await readFlashcards(flashcardsPath())).cards.map(presentFlashcard));
  ipcMain.handle('flashcards:save', (_event, payload) => serializeFlashcardWrite(async () => presentFlashcardResult(await upsertFlashcard(flashcardsPath(), payload))));
  ipcMain.handle('flashcards:examples', async (_event, payload) => {
    const settings = await loadSettings();
    const apiKey = settings.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('Add an OpenAI API key in Settings to generate conversation examples.');
    const generated = await createCoach({ ...settings, apiKey }).generateFlashcardExamples(payload);
    return serializeFlashcardWrite(async () => presentFlashcardResult(await upsertFlashcard(flashcardsPath(), {
      ...payload,
      nativeScript: generated.nativeScript,
      romanization: generated.romanization,
      meaning: generated.meaning,
      language: generated.language,
      examples: generated.examples,
    })));
  });
  ipcMain.handle('flashcards:delete', (_event, id) => serializeFlashcardWrite(async () => (await deleteFlashcard(flashcardsPath(), id)).map(presentFlashcard)));
  ipcMain.handle('flashcards:review', (_event, id, rating) => serializeFlashcardWrite(async () => presentFlashcardResult(await reviewFlashcard(flashcardsPath(), id, rating))));
  ipcMain.handle('settings:load', loadSettings);
  ipcMain.handle('settings:save', (_event, settings) => saveSettings(settings));
  ipcMain.handle('external:open', (_event, url) => shell.openExternal(url));
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
