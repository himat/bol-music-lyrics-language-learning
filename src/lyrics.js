const { parseLRC } = require('./lrc');

const BASE_URL = 'https://lrclib.net/api';

async function request(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Bol language learner v0.1 (personal desktop app)' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    const error = new Error(response.status === 404 ? 'No synchronized lyrics found for this track.' : `Lyrics service returned ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function normalize(record) {
  const timed = parseLRC(record.syncedLyrics || '');
  const lines = timed.length
    ? timed
    : String(record.plainLyrics || '').split(/\r?\n/).filter(Boolean).map((text, index) => ({ index, timeMs: null, text }));
  return {
    id: record.id,
    trackName: record.trackName,
    artistName: record.artistName,
    instrumental: Boolean(record.instrumental),
    synced: timed.length > 0,
    lines,
  };
}

async function fetchLyrics(track) {
  const params = new URLSearchParams({ track_name: track.title, artist_name: track.artist });
  if (track.album) params.set('album_name', track.album);
  if (track.durationMs > 1000) params.set('duration', String(Math.round(track.durationMs / 1000)));
  try {
    return normalize(await request(`${BASE_URL}/get?${params}`));
  } catch (error) {
    if (error.status !== 404) throw error;
    const search = new URLSearchParams({ track_name: track.title, artist_name: track.artist });
    const results = await request(`${BASE_URL}/search?${search}`);
    if (!Array.isArray(results) || !results.length) throw error;
    const preferred = results.find((item) => item.syncedLyrics) || results[0];
    return normalize(preferred);
  }
}

module.exports = { fetchLyrics, normalize };
