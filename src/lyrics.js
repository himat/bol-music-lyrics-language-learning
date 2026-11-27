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
  const timed = stripEmbeddedTranslations(parseLRC(record.syncedLyrics || ''));
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

// Some community LRCs place a parenthesized English translation at the same
// timestamp as each original. Require a repeated bilingual pattern rather than
// dropping parentheses or simultaneous vocals in ordinary lyrics.
function stripEmbeddedTranslations(lines) {
  const englishWords = new Set('i me my mine you your yours we us our they them their he him his she her it its the a an is are was were be been am have has had do does did will would can could should to of in on for with from into and but since when where who what how not no everything together'.split(' '));
  const englishScore = (text) => (text.toLowerCase().match(/[a-z]+/g) || []).filter((word) => englishWords.has(word)).length;
  const groups = new Map();
  for (const line of lines) {
    if (!groups.has(line.timeMs)) groups.set(line.timeMs, []);
    groups.get(line.timeMs).push(line);
  }
  const translations = new Set();
  let englishPairs = 0;
  for (const group of groups.values()) {
    if (group.length !== 2) continue;
    const [original, translation] = group;
    if (!/^\(.+\)$/.test(translation.text) || /^\(/.test(original.text)) continue;
    translations.add(translation);
    const translatedScore = englishScore(translation.text);
    if (translatedScore >= 2 && translatedScore > englishScore(original.text)) englishPairs++;
  }
  // Once the track-wide pattern is established, also omit accompanying notes
  // such as "(Classical music notes / Sargam)" in the same translation slot.
  if (englishPairs < 3 || englishPairs < groups.size * 0.6) return lines;
  return lines.filter((line) => !translations.has(line)).map((line, index) => ({ ...line, index }));
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
  let preferred = chooseBestLyrics(exact, results, track.durationMs, targetLanguage);
  // Soundtracks may credit the composer in Spotify and the singer in LRCLIB.
  // Only relax the artist when album, title and recording length corroborate it.
  if (!preferred && track.album && track.durationMs > 1000) {
    const albumSearch = new URLSearchParams({ track_name: track.title, album_name: track.album });
    const albumResults = await request(`${BASE_URL}/search?${albumSearch}`);
    const identity = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const matches = (Array.isArray(albumResults) ? albumResults : []).filter((record) =>
      identity(record.trackName) === identity(track.title)
      && identity(record.albumName) === identity(track.album)
      && Number(record.duration) > 0
      && Math.abs(Number(record.duration) * 1000 - track.durationMs) <= 3000
      && (String(record.syncedLyrics || '').trim() || String(record.plainLyrics || '').trim()));
    // With the artist unverified, recording length takes priority over timing
    // availability. Do not substitute a less precise synced version for an
    // exact-length original; tolerate subsecond metadata rounding only.
    const closestDistance = Math.min(...matches.map((record) => Math.abs(Number(record.duration) * 1000 - track.durationMs)));
    const closest = matches.filter((record) => Math.abs(Number(record.duration) * 1000 - track.durationMs) <= closestDistance + 500);
    preferred = chooseBestLyrics(null, closest, track.durationMs, targetLanguage);
  }
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
  const rawTimed = parseLRC(record.syncedLyrics || '');
  const timed = stripEmbeddedTranslations(rawTimed);
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
    embeddedTranslationRatio: rawTimed.length ? (rawTimed.length - timed.length) / rawTimed.length : 0,
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
      || left.embeddedTranslationRatio - right.embeddedTranslationRatio
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
