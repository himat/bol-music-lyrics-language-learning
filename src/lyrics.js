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

async function fetchLyrics(track, targetLanguage = 'Hindi') {
  const params = new URLSearchParams({ track_name: track.title, artist_name: track.artist });
  if (track.album) params.set('album_name', track.album);
  if (track.durationMs > 1000) params.set('duration', String(Math.round(track.durationMs / 1000)));
  let exact = null;
  try {
    exact = await request(`${BASE_URL}/get?${params}`);
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  const search = new URLSearchParams({ track_name: track.title, artist_name: track.artist });
  let results = [];
  try {
    results = await request(`${BASE_URL}/search?${search}`);
  } catch (error) {
    if (exact) return normalize(exact);
    throw error;
  }
  const preferred = chooseBestLyrics(exact, results, track.durationMs, targetLanguage);
  if (!preferred) {
    const error = new Error('No lyrics found for this track.');
    error.status = 404;
    throw error;
  }
  return normalize(preferred);
}

const NATIVE_SCRIPT_PATTERNS = {
  hindi: /[\u0900-\u097f]/u,
  marathi: /[\u0900-\u097f]/u,
  nepali: /[\u0900-\u097f]/u,
  punjabi: /[\u0a00-\u0a7f]/u,
  urdu: /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u,
};

const SOUTH_ASIAN_SCRIPT_PATTERN = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\u0900-\u0dff]/u;

function timedCoverageWordCount(timed) {
  const wordsByTimestamp = new Map();
  timed.forEach((line) => {
    const wordCount = (line.text.match(/[\p{L}\p{M}\p{N}]+/gu) || []).length;
    const previous = wordsByTimestamp.get(line.timeMs);
    wordsByTimestamp.set(line.timeMs, previous == null ? wordCount : Math.min(previous, wordCount));
  });
  return [...wordsByTimestamp.values()].reduce((total, count) => total + count, 0);
}

function lyricsMetrics(record, targetLanguage) {
  const timed = parseLRC(record.syncedLyrics || '');
  const text = timed.length
    ? timed.map((line) => line.text).join(' ')
    : String(record.plainLyrics || '');
  const words = text.match(/[\p{L}\p{M}\p{N}]+/gu) || [];
  const scriptPattern = NATIVE_SCRIPT_PATTERNS[String(targetLanguage || '').trim().toLowerCase()];
  const letters = [...text].filter((character) => /[\p{L}\p{M}]/u.test(character));
  const nativeScriptRatio = scriptPattern && letters.length
    ? letters.filter((character) => scriptPattern.test(character)).length / letters.length
    : 0;
  const southAsianScriptRatio = letters.length
    ? letters.filter((character) => SOUTH_ASIAN_SCRIPT_PATTERN.test(character)).length / letters.length
    : 0;
  const uniqueTimedCues = new Set(timed.map((line) => line.timeMs)).size;
  return {
    wordCount: words.length,
    coverageWordCount: timed.length ? timedCoverageWordCount(timed) : words.length,
    endTimeMs: timed.at(-1)?.timeMs || 0,
    nativeScriptRatio,
    southAsianScriptRatio,
    stackedLineRatio: timed.length ? (timed.length - uniqueTimedCues) / timed.length : 0,
  };
}

function rankCompleteLyrics(records, exact, distance, targetLanguage) {
  if (!records.length) return null;
  const metrics = new Map(records.map((record) => [record, lyricsMetrics(record, targetLanguage)]));
  const maxCoverageWordCount = Math.max(...records.map((record) => metrics.get(record).coverageWordCount));
  const maxEndTimeMs = Math.max(...records.map((record) => metrics.get(record).endTimeMs));
  const complete = records.filter((record) => {
    const candidate = metrics.get(record);
    const hasWordCoverage = !maxCoverageWordCount || candidate.coverageWordCount >= maxCoverageWordCount * 0.9;
    const hasEndingCoverage = !maxEndTimeMs || candidate.endTimeMs >= maxEndTimeMs - 10000;
    return hasWordCoverage && hasEndingCoverage;
  });
  const candidates = complete.length ? complete : records;
  return candidates.sort((a, b) => {
    const left = metrics.get(a);
    const right = metrics.get(b);
    return right.nativeScriptRatio - left.nativeScriptRatio
      || right.southAsianScriptRatio - left.southAsianScriptRatio
      || left.stackedLineRatio - right.stackedLineRatio
      || right.coverageWordCount - left.coverageWordCount
      || right.endTimeMs - left.endTimeMs
      || Number(b === exact) - Number(a === exact)
      || distance(a) - distance(b);
  })[0];
}

function chooseBestLyrics(exact, results, durationMs = 0, targetLanguage = 'Hindi') {
  const records = [exact, ...(Array.isArray(results) ? results : [])].filter(Boolean);
  if (!records.length) return null;
  const targetSeconds = durationMs / 1000;
  const distance = (record) => targetSeconds > 0 ? Math.abs(Number(record.duration || 0) - targetSeconds) : 0;
  const durationMatched = records.filter((record) => !targetSeconds || distance(record) <= 3);
  const pool = durationMatched.length ? durationMatched : records;
  const synced = pool.filter((record) => record.syncedLyrics);
  return rankCompleteLyrics(synced, exact, distance, targetLanguage)
    || rankCompleteLyrics(pool, exact, distance, targetLanguage);
}

module.exports = { fetchLyrics, normalize, chooseBestLyrics };
