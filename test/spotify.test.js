const test = require('node:test');
const assert = require('node:assert/strict');
const { spotifyControlScript, spotifySeekScript } = require('../src/spotify');

test('maps only supported Spotify transport controls', () => {
  assert.equal(spotifyControlScript('previous'), 'tell application "Spotify" to previous track');
  assert.equal(spotifyControlScript('playPause'), 'tell application "Spotify" to playpause');
  assert.equal(spotifyControlScript('next'), 'tell application "Spotify" to next track');
  assert.equal(spotifyControlScript('repeatOff'), 'tell application "Spotify" to set repeating to false');
  assert.equal(spotifyControlScript('repeatContext'), 'tell application "Spotify" to set repeating to true');
  assert.throws(() => spotifyControlScript('deletePlaylist'), /Unknown Spotify control/);
});

test('maps a lyric timestamp to a safe Spotify seek command', () => {
  assert.equal(spotifySeekScript(75432), 'tell application "Spotify" to set player position to 75.432');
  assert.equal(spotifySeekScript(0), 'tell application "Spotify" to set player position to 0');
  assert.equal(
    spotifySeekScript(75432, true),
    'tell application "Spotify"\n  set player position to 75.432\n  if player state is not playing then playpause\nend tell',
  );
  assert.throws(() => spotifySeekScript(-1), /Invalid Spotify seek position/);
  assert.throws(() => spotifySeekScript('not-a-time'), /Invalid Spotify seek position/);
});
