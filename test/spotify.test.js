const test = require('node:test');
const assert = require('node:assert/strict');
const { spotifyControlScript } = require('../src/spotify');

test('maps only supported Spotify transport controls', () => {
  assert.equal(spotifyControlScript('previous'), 'tell application "Spotify" to previous track');
  assert.equal(spotifyControlScript('playPause'), 'tell application "Spotify" to playpause');
  assert.equal(spotifyControlScript('next'), 'tell application "Spotify" to next track');
  assert.throws(() => spotifyControlScript('deletePlaylist'), /Unknown Spotify control/);
});
