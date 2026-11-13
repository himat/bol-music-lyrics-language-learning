const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { flashcardId, readFlashcards, upsertFlashcard, deleteFlashcard, reviewFlashcard, normalizeRomanization } = require('../src/flashcards');

test('normalizes non-English romanization to sentence case', () => {
  assert.equal(normalizeRomanization('Agar tum Sath ho', 'Hindi'), 'Agar tum sath ho');
  assert.equal(normalizeRomanization('MUJHE Delhi JAANA HAI', 'Hindi'), 'Mujhe delhi jaana hai');
  assert.equal(normalizeRomanization('API Response', 'English'), 'API Response');
});

test('saves one card per language and word while merging source contexts', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bol-flashcards-'));
  const file = path.join(directory, 'flashcards.json');
  const first = await upsertFlashcard(file, {
    word: 'आँखों', romanization: 'aankhon', meaning: 'eyes', language: 'Hindi',
    context: { text: 'आँखों में', translation: 'in the eyes', songTitle: 'One', artist: 'Singer' },
  });
  const second = await upsertFlashcard(file, {
    word: 'आँखों', romanization: 'aankhon', meaning: 'eyes', language: 'Hindi',
    context: { text: 'मेरी आँखों से', translation: 'with my eyes', songTitle: 'Two', artist: 'Singer' },
    examples: [{ text: 'मेरी आँखों में देखो', romanization: 'meri aankhon mein dekho', translation: 'Look into my eyes.' }],
  });
  assert.equal(first.created, true);
  assert.equal(first.card.kind, 'word');
  assert.equal(second.created, false);
  assert.equal(second.cards.length, 1);
  assert.equal(second.card.contexts.length, 2);
  assert.equal(second.card.examples.length, 1);
  assert.equal(second.card.id, flashcardId('Hindi', 'आँखों'));
});

test('persists phrase cards and their generated daily examples', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bol-flashcards-'));
  const file = path.join(directory, 'flashcards.json');
  const { card } = await upsertFlashcard(file, {
    kind: 'phrase',
    word: 'मुझे थोड़ी देर चाहिए',
    nativeScript: 'मुझे थोड़ी देर चाहिए',
    romanization: 'mujhe thodi der chahiye',
    meaning: 'I need a little time',
    language: 'Hindi',
    examples: [
      { text: 'सोचने के लिए मुझे थोड़ी देर चाहिए।', romanization: 'sochne ke liye mujhe thodi der chahiye', translation: 'I need a little time to think.' },
      { text: 'मुझे थोड़ी देर चाहिए, फिर बात करते हैं।', romanization: 'mujhe thodi der chahiye, phir baat karte hain', translation: 'I need a little time; then we can talk.' },
      { text: 'तैयार होने में मुझे थोड़ी देर चाहिए।', romanization: 'taiyar hone mein mujhe thodi der chahiye', translation: 'I need a little time to get ready.' },
    ],
  });
  assert.equal(card.kind, 'phrase');
  assert.equal(card.examples.length, 3);
  assert.equal((await readFlashcards(file)).cards[0].kind, 'phrase');
});

test('persists review results and deletes cards', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bol-flashcards-'));
  const file = path.join(directory, 'flashcards.json');
  const { card } = await upsertFlashcard(file, { word: 'चलो', meaning: 'let us go', language: 'Hindi' });
  await reviewFlashcard(file, card.id, 'good', Date.parse('2026-11-09T18:00:00.000Z'));
  await reviewFlashcard(file, card.id, 'again', Date.parse('2026-11-09T18:10:00.000Z'));
  let store = await readFlashcards(file);
  assert.equal(store.cards[0].study.reviews, 2);
  assert.equal(store.cards[0].study.phase, 'learning');
  assert.equal(store.cards[0].study.lastRating, 'again');
  await deleteFlashcard(file, card.id);
  store = await readFlashcards(file);
  assert.equal(store.cards.length, 0);
});
