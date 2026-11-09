const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLRC, activeLineIndex } = require('../src/lrc');

test('parses, sorts, and indexes LRC timestamps', () => {
  const lines = parseLRC('[00:12.50]second\n[00:01.250]first\n[00:12.50][00:20.00]repeat');
  assert.deepEqual(lines, [
    { index: 0, timeMs: 1250, text: 'first' },
    { index: 1, timeMs: 12500, text: 'second' },
    { index: 2, timeMs: 12500, text: 'repeat' },
    { index: 3, timeMs: 20000, text: 'repeat' },
  ]);
});

test('finds the active line at a playback position', () => {
  const lines = parseLRC('[00:01.00]one\n[00:03.00]two\n[00:05.00]three');
  assert.equal(activeLineIndex(lines, 999), -1);
  assert.equal(activeLineIndex(lines, 3000), 1);
  assert.equal(activeLineIndex(lines, 9000), 2);
});
