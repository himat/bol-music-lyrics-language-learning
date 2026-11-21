const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseBestLyrics } = require('../src/lyrics');

test('prefers duration-matched synchronized lyrics over an exact plain record', () => {
  const exact = { id: 1, duration: 277, plainLyrics: 'plain', syncedLyrics: null };
  const synced = { id: 2, duration: 276.96, plainLyrics: 'plain', syncedLyrics: '[00:10.00] line' };
  const wrongVersion = { id: 3, duration: 210, syncedLyrics: '[00:10.00] wrong version' };
  assert.equal(chooseBestLyrics(exact, [exact, wrongVersion, synced], 276000).id, 2);
});

test('keeps exact plain lyrics when no synchronized match exists', () => {
  const exact = { id: 1, duration: 200, plainLyrics: 'plain', syncedLyrics: null };
  assert.equal(chooseBestLyrics(exact, [], 200000), exact);
});

test('rejects a short exact synced record when a complete duration match exists', () => {
  const shortExact = { id: 1, duration: 309, syncedLyrics: '[00:10.00] refrain\n[00:20.00] refrain' };
  const complete = { id: 2, duration: 308, syncedLyrics: Array.from({ length: 24 }, (_, index) => `[${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}.00] line ${index}`).join('\n') };
  assert.equal(chooseBestLyrics(shortExact, [shortExact, complete], 308000).id, 2);
});

test('prefers complete Devanagari lyrics over an equally complete split romanization', () => {
  const romanized = {
    id: 1,
    duration: 196,
    syncedLyrics: '[00:01.00] ek\n[00:02.00] do\n[00:03.00] teen\n[00:04.00] chaar\n[00:05.00] paanch\n[00:06.00] chhah',
  };
  const devanagari = {
    id: 2,
    duration: 196,
    syncedLyrics: '[00:01.00] एक दो\n[00:03.00] तीन चार\n[00:06.00] पाँच छह',
  };

  assert.equal(chooseBestLyrics(null, [romanized, devanagari], 196000, 'Hindi').id, 2);
});

test('does not prefer native script when it omits a material part of the song', () => {
  const completeRomanized = {
    id: 1,
    duration: 196,
    syncedLyrics: '[00:01.00] ek do teen\n[00:06.00] chaar paanch chhah',
  };
  const incompleteDevanagari = {
    id: 2,
    duration: 196,
    syncedLyrics: '[00:01.00] एक दो',
  };

  assert.equal(chooseBestLyrics(null, [completeRomanized, incompleteDevanagari], 196000, 'Hindi').id, 1);
});

test('prefers complete Gurmukhi lyrics for Punjabi', () => {
  const romanized = { id: 1, duration: 200, syncedLyrics: '[00:01.00] tu kithe chaliye' };
  const gurmukhi = { id: 2, duration: 200, syncedLyrics: '[00:01.00] ਤੂੰ ਕਿੱਥੇ ਚੱਲੀਏ' };

  assert.equal(chooseBestLyrics(null, [romanized, gurmukhi], 200000, 'Punjabi').id, 2);
});

test('rejects a stacked romanization and English translation track in favor of clean native lyrics', () => {
  const bilingual = {
    id: 1,
    duration: 208,
    syncedLyrics: [
      '[00:04.33] naa ja, naa ja, naa ja',
      "[00:04.33] Don't go, don't go, don't go",
      "[00:09.81] ni kudi ayy tu alright, aaja nede, I won't bite",
      "[00:09.81] Girl, you are alright, come closer, I won't bite",
    ].join('\n'),
  };
  const gurmukhi = {
    id: 2,
    duration: 208,
    syncedLyrics: [
      '[00:04.39] ਨਾ ਜਾ, ਨਾ ਜਾ, ਨਾ ਜਾ',
      "[00:09.81] ਨੀ ਕੁੜੀ ਏ ਤੂੰ alright, ਆਜਾ ਨੇੜੇ, I won't bite",
    ].join('\n'),
  };

  assert.equal(chooseBestLyrics(null, [bilingual, gurmukhi], 208000, 'Hindi').id, 2);
});

test('rejects stacked translations when only romanized originals are available', () => {
  const bilingual = {
    id: 1,
    duration: 208,
    syncedLyrics: '[00:04.33] naa ja\n[00:04.33] do not go\n[00:09.81] aaja nede\n[00:09.81] come closer',
  };
  const clean = {
    id: 2,
    duration: 208,
    syncedLyrics: '[00:04.33] naa ja\n[00:09.81] aaja nede',
  };

  assert.equal(chooseBestLyrics(null, [bilingual, clean], 208000, 'Hindi').id, 2);
});
