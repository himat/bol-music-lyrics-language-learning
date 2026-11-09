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
  set parts to {player state as text, name of t, artist of t, album of t, duration of t as text, player position as text, artwork url of t, spotify url of t}
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
    const [state, title, artist, album, duration, position, artworkUrl, spotifyUrl] = value.split(separator);
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
  };
  if (!commands[action]) throw new Error('Unknown Spotify control.');
  return `tell application "Spotify" to ${commands[action]}`;
}

async function controlSpotify(action) {
  if (process.platform !== 'darwin') throw new Error('Spotify controls currently require macOS.');
  await execFileAsync('/usr/bin/osascript', ['-e', spotifyControlScript(action)], { timeout: 3000 });
  return getSpotifyState();
}

module.exports = { getSpotifyState, controlSpotify, spotifyControlScript };
