const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { defaultStudyState, normalizeStudyState, scheduleReview } = require('./spaced-repetition');

function clean(value) {
  return String(value || '').trim();
}

function normalizeWord(value) {
  return clean(value).normalize('NFKC').toLocaleLowerCase();
}

function normalizeRomanization(value, language) {
  const romanization = clean(value);
  if (!romanization || normalizeWord(language) === 'english') return romanization;
  return romanization.toLocaleLowerCase('en');
}

function flashcardId(language, word) {
  return crypto.createHash('sha256').update(`${normalizeWord(language)}\0${normalizeWord(word)}`).digest('hex').slice(0, 20);
}

function emptyStore() {
  return { version: 1, cards: [] };
}

async function readFlashcards(filePath) {
  try {
    const value = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (value?.version !== 1 || !Array.isArray(value.cards)) return emptyStore();
    return { ...value, cards: value.cards.map((card) => ({ ...card, contexts: dedupeContexts(card.contexts) })) };
  } catch {
    return emptyStore();
  }
}

async function writeFlashcards(filePath, store) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(store, null, 2));
  await fs.rename(temporaryPath, filePath);
}

function contextKey(context) {
  return [context.text, context.songTitle, context.artist].map(normalizeWord).join('\0');
}

function sanitizeContext(context = {}) {
  const timeMs = context.timeMs === null || context.timeMs === undefined ? NaN : Number(context.timeMs);
  const lyricIndex = context.lyricIndex === null || context.lyricIndex === undefined ? NaN : Number(context.lyricIndex);
  return {
    text: clean(context.text),
    translation: clean(context.translation),
    songTitle: clean(context.songTitle),
    artist: clean(context.artist),
    album: clean(context.album),
    spotifyUrl: /^spotify:track:[A-Za-z0-9]+$/.test(clean(context.spotifyUrl)) ? clean(context.spotifyUrl) : '',
    timeMs: Number.isFinite(timeMs) && timeMs >= 0 ? timeMs : null,
    lyricIndex: Number.isInteger(lyricIndex) && lyricIndex >= 0 ? lyricIndex : null,
    savedAt: context.savedAt || new Date().toISOString(),
  };
}

function dedupeContexts(contexts = []) {
  const unique = new Map();
  for (const rawContext of contexts) {
    const context = sanitizeContext(rawContext);
    if (!context.text) continue;
    const key = contextKey(context);
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, context);
      continue;
    }
    unique.set(key, {
      ...existing,
      translation: existing.translation || context.translation,
      album: existing.album || context.album,
      spotifyUrl: existing.spotifyUrl || context.spotifyUrl,
      timeMs: existing.timeMs ?? context.timeMs,
      lyricIndex: existing.lyricIndex ?? context.lyricIndex,
    });
  }
  return [...unique.values()];
}

function sanitizeExamples(examples = [], language = '') {
  return examples.slice(0, 3).map((example) => ({
    text: clean(example.text),
    romanization: normalizeRomanization(example.romanization, language),
    translation: clean(example.translation),
    wordGlosses: sanitizeWordGlosses(example.wordGlosses, language),
  })).filter((example) => example.text && example.translation);
}

function sanitizeWordGlosses(glosses = [], language = '') {
  return glosses.map((gloss) => ({
    word: clean(gloss.word),
    romanization: normalizeRomanization(gloss.romanization, language),
    meaning: clean(gloss.meaning),
  })).filter((gloss) => gloss.word && gloss.meaning);
}

async function upsertFlashcard(filePath, input) {
  const store = await readFlashcards(filePath);
  const id = flashcardId(input.language, input.word);
  const existingIndex = store.cards.findIndex((card) => card.id === id);
  const existing = existingIndex >= 0 ? store.cards[existingIndex] : null;
  const now = new Date().toISOString();
  const incomingContext = sanitizeContext(input.context);
  const contexts = dedupeContexts([...(existing?.contexts || []), incomingContext]);
  const language = clean(input.language) || existing?.language || 'Unknown';
  const incomingExamples = sanitizeExamples(input.examples, language);
  const incomingWordGlosses = sanitizeWordGlosses(input.wordGlosses, language);
  const card = {
    id,
    kind: input.kind === 'phrase' ? 'phrase' : (existing?.kind || 'word'),
    word: clean(input.word) || existing?.word || '',
    nativeScript: clean(input.nativeScript) || existing?.nativeScript || '',
    romanization: normalizeRomanization(input.romanization, language) || existing?.romanization || '',
    meaning: clean(input.meaning) || existing?.meaning || '',
    language,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    contexts,
    wordGlosses: incomingWordGlosses.length ? incomingWordGlosses : (existing?.wordGlosses || []),
    examples: incomingExamples.length ? incomingExamples : (existing?.examples || []),
    study: normalizeStudyState(existing?.study || defaultStudyState()),
  };
  if (existingIndex >= 0) store.cards[existingIndex] = card;
  else store.cards.unshift(card);
  await writeFlashcards(filePath, store);
  return { card, created: existingIndex < 0, cards: store.cards };
}

async function deleteFlashcard(filePath, id) {
  const store = await readFlashcards(filePath);
  store.cards = store.cards.filter((card) => card.id !== id);
  await writeFlashcards(filePath, store);
  return store.cards;
}

async function reviewFlashcard(filePath, id, rating, now = Date.now()) {
  const store = await readFlashcards(filePath);
  const card = store.cards.find((item) => item.id === id);
  if (!card) throw new Error('Flashcard not found.');
  card.study = scheduleReview(card.study, rating, now);
  card.updatedAt = card.study.lastReviewedAt;
  await writeFlashcards(filePath, store);
  return { card, cards: store.cards };
}

module.exports = { flashcardId, readFlashcards, upsertFlashcard, deleteFlashcard, reviewFlashcard, sanitizeExamples, sanitizeWordGlosses, normalizeRomanization, dedupeContexts };
