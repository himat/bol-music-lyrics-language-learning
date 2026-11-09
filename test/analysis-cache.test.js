const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { analysisCacheKey, readAnalysisCache, writeAnalysisCache } = require('../src/analysis-cache');

const request = {
  track: { title: 'Sahiba', artist: 'Aditya Rikhari', album: 'Sahiba', durationMs: 190000, spotifyUrl: 'spotify:track:123' },
  lines: [{ index: 0, timeMs: 10000, text: 'Saahiba, aaye ghar kahe na?' }],
  model: 'gpt-4o-mini',
  targetLanguage: 'Hindi',
};

test('builds stable analysis keys and separates changed inputs', () => {
  assert.equal(analysisCacheKey(request), analysisCacheKey(structuredClone(request)));
  assert.notEqual(analysisCacheKey(request), analysisCacheKey({ ...request, model: 'gpt-5-mini' }));
  assert.notEqual(analysisCacheKey(request), analysisCacheKey({ ...request, targetLanguage: 'Punjabi' }));
  assert.notEqual(analysisCacheKey(request), analysisCacheKey({ ...request, lines: [{ ...request.lines[0], text: 'Different lyrics' }] }));
});

test('persists and retrieves song analysis', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bol-analysis-cache-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const key = analysisCacheKey(request);
  const analysis = { summary: 'Cached', lines: [{ index: 0, translation: 'Beloved, why not come home?' }] };
  assert.equal(await readAnalysisCache(directory, key), null);
  await writeAnalysisCache(directory, key, analysis);
  assert.deepEqual(await readAnalysisCache(directory, key), analysis);
});
