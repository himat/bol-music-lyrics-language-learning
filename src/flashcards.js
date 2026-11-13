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
    return value?.version === 1 && Array.isArray(value.cards) ? value : emptyStore();
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
  return [context.text, context.translation, context.songTitle, context.artist].map(normalizeWord).join('\0');
}

function sanitizeContext(context = {}) {
  return {
    text: clean(context.text),
    translation: clean(context.translation),
    songTitle: clean(context.songTitle),
    artist: clean(context.artist),
    album: clean(context.album),
    savedAt: context.savedAt || new Date().toISOString(),
  };
}

function sanitizeExamples(examples = [], language = '') {
  return examples.slice(0, 3).map((example) => ({
    text: clean(example.text),
    romanization: normalizeRomanization(example.romanization, language),
    translation: clean(example.translation),
  })).filter((example) => example.text && example.translation);
}

async function upsertFlashcard(filePath, input) {
  const store = await readFlashcards(filePath);
  const id = flashcardId(input.language, input.word);
  const existingIndex = store.cards.findIndex((card) => card.id === id);
  const existing = existingIndex >= 0 ? store.cards[existingIndex] : null;
  const now = new Date().toISOString();
  const incomingContext = sanitizeContext(input.context);
  const contexts = [...(existing?.contexts || [])];
  if (incomingContext.text && !contexts.some((context) => contextKey(context) === contextKey(incomingContext))) contexts.push(incomingContext);
  const language = clean(input.language) || existing?.language || 'Unknown';
  const incomingExamples = sanitizeExamples(input.examples, language);
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

module.exports = { flashcardId, readFlashcards, upsertFlashcard, deleteFlashcard, reviewFlashcard, sanitizeExamples, normalizeRomanization };
