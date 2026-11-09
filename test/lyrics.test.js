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
