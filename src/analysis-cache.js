const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const ANALYSIS_CACHE_VERSION = 'word-glosses-v1';

function analysisCacheKey({ track, lines, model, targetLanguage }) {
  const identity = {
    version: ANALYSIS_CACHE_VERSION,
    model: String(model || ''),
    targetLanguage: String(targetLanguage || ''),
    track: {
      title: String(track?.title || ''),
      artist: String(track?.artist || ''),
      album: String(track?.album || ''),
      durationMs: Number(track?.durationMs) || 0,
      spotifyUrl: String(track?.spotifyUrl || ''),
    },
    lines: (lines || []).map((line) => ({
      index: line.index,
      timeMs: Number.isFinite(line.timeMs) ? line.timeMs : null,
      text: String(line.text || ''),
    })),
  };
  return crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

async function readAnalysisCache(cacheDirectory, key) {
  try {
    const stored = JSON.parse(await fs.readFile(path.join(cacheDirectory, `${key}.json`), 'utf8'));
    return stored.version === ANALYSIS_CACHE_VERSION ? stored.analysis : null;
  } catch {
    return null;
  }
}

async function writeAnalysisCache(cacheDirectory, key, analysis) {
  await fs.mkdir(cacheDirectory, { recursive: true });
  const destination = path.join(cacheDirectory, `${key}.json`);
  const temporary = `${destination}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify({ version: ANALYSIS_CACHE_VERSION, savedAt: new Date().toISOString(), analysis }));
  await fs.rename(temporary, destination);
}

module.exports = { ANALYSIS_CACHE_VERSION, analysisCacheKey, readAnalysisCache, writeAnalysisCache };
