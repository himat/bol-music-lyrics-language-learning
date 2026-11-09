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
  let exact = null;
  try {
    exact = await request(`${BASE_URL}/get?${params}`);
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  if (exact?.syncedLyrics) return normalize(exact);
  const search = new URLSearchParams({ track_name: track.title, artist_name: track.artist });
  let results = [];
  try {
    results = await request(`${BASE_URL}/search?${search}`);
  } catch (error) {
    if (exact) return normalize(exact);
    throw error;
  }
  const preferred = chooseBestLyrics(exact, results, track.durationMs);
  if (!preferred) {
    const error = new Error('No lyrics found for this track.');
    error.status = 404;
    throw error;
  }
  return normalize(preferred);
}

function chooseBestLyrics(exact, results, durationMs = 0) {
  const records = [exact, ...(Array.isArray(results) ? results : [])].filter(Boolean);
  if (!records.length) return null;
  const targetSeconds = durationMs / 1000;
  const distance = (record) => targetSeconds > 0 ? Math.abs(Number(record.duration || 0) - targetSeconds) : 0;
  const durationMatched = records.filter((record) => !targetSeconds || distance(record) <= 3);
  const pool = durationMatched.length ? durationMatched : records;
  const synced = pool.filter((record) => record.syncedLyrics).sort((a, b) => distance(a) - distance(b));
  return synced[0] || exact || pool[0];
}

module.exports = { fetchLyrics, normalize, chooseBestLyrics };
