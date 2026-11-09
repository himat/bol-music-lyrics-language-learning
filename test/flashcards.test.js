const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { flashcardId, readFlashcards, upsertFlashcard, deleteFlashcard, reviewFlashcard } = require('../src/flashcards');

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
  assert.equal(second.created, false);
  assert.equal(second.cards.length, 1);
  assert.equal(second.card.contexts.length, 2);
  assert.equal(second.card.examples.length, 1);
  assert.equal(second.card.id, flashcardId('Hindi', 'आँखों'));
});

test('persists review results and deletes cards', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bol-flashcards-'));
  const file = path.join(directory, 'flashcards.json');
  const { card } = await upsertFlashcard(file, { word: 'चलो', meaning: 'let us go', language: 'Hindi' });
  await reviewFlashcard(file, card.id, true);
  await reviewFlashcard(file, card.id, false);
  let store = await readFlashcards(file);
  assert.deepEqual(store.cards[0].study, { seen: 2, correct: 1, again: 1, lastReviewedAt: store.cards[0].study.lastReviewedAt });
  await deleteFlashcard(file, card.id);
  store = await readFlashcards(file);
  assert.equal(store.cards.length, 0);
});
