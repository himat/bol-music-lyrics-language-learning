const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

const separator = '\u001f';
const script = `
tell application "System Events"
  set spotifyIsRunning to (name of processes) contains "Spotify"
end tell
if spotifyIsRunning is false then return "not_running"
tell application "Spotify"
  set t to current track
  set parts to {player state as text, name of t, artist of t, album of t, duration of t as text, player position as text, artwork url of t, spotify url of t, repeating as text}
  set AppleScript's text item delimiters to ASCII character 31
  return parts as text
end tell
`;

async function getSpotifyState() {
  if (process.platform !== 'darwin') {
    return { available: false, reason: 'Bol’s local Spotify connection currently requires macOS.' };
  }
  try {
    const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', script], { timeout: 3000 });
    const value = stdout.trim();
    if (value === 'not_running') return { available: false, reason: 'Open Spotify and play a song.' };
    const [state, title, artist, album, duration, position, artworkUrl, spotifyUrl, repeating] = value.split(separator);
    return {
      available: true,
      isPlaying: state === 'playing',
      state,
      title,
      artist,
      album,
      durationMs: Number(duration) || 0,
      positionMs: Math.round((Number(position) || 0) * 1000),
      artworkUrl,
      spotifyUrl,
      repeatMode: repeating === 'true' ? 'context' : 'off',
      observedAt: Date.now(),
    };
  } catch (error) {
    const message = String(error.stderr || error.message || error);
    const permissionDenied = /not authorized|assistive access|Apple events/i.test(message);
    return {
      available: false,
      permissionDenied,
      reason: permissionDenied
        ? 'Allow Bol to control Spotify in System Settings → Privacy & Security → Automation.'
        : 'Could not read Spotify. Make sure the Spotify desktop app is open.',
      detail: message,
    };
  }
}

function spotifyControlScript(action) {
  const commands = {
    previous: 'previous track',
    playPause: 'playpause',
    next: 'next track',
    repeatOff: 'set repeating to false',
    repeatContext: 'set repeating to true',
  };
  if (!commands[action]) throw new Error('Unknown Spotify control.');
  return `tell application "Spotify" to ${commands[action]}`;
}

async function controlSpotify(action) {
  if (process.platform !== 'darwin') throw new Error('Spotify controls currently require macOS.');
  await execFileAsync('/usr/bin/osascript', ['-e', spotifyControlScript(action)], { timeout: 3000 });
  return getSpotifyState();
}

function spotifySeekScript(positionMs, shouldPlay = false) {
  const milliseconds = Number(positionMs);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new Error('Invalid Spotify seek position.');
  const seek = `set player position to ${milliseconds / 1000}`;
  return shouldPlay
    ? `tell application "Spotify"\n  ${seek}\n  if player state is not playing then playpause\nend tell`
    : `tell application "Spotify" to ${seek}`;
}

async function seekSpotify(positionMs, shouldPlay = false) {
  if (process.platform !== 'darwin') throw new Error('Spotify seeking currently requires macOS.');
  await execFileAsync('/usr/bin/osascript', ['-e', spotifySeekScript(positionMs, shouldPlay)], { timeout: 3000 });
  return getSpotifyState();
}

module.exports = { getSpotifyState, controlSpotify, seekSpotify, spotifyControlScript, spotifySeekScript };
