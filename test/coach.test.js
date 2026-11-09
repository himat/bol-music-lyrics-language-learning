const test = require('node:test');
const assert = require('node:assert/strict');
const { extractOutputText, planAnalysis, analysisSchema, lexicalWords, findMissingGlosses, mergeGlossCorrections } = require('../src/coach');

test('extracts text from a raw Responses API payload', () => {
  const response = {
    output: [{
      type: 'message',
      content: [
        { type: 'output_text', text: '{"language":"Punjabi"}' },
        { type: 'refusal', refusal: '' },
      ],
    }],
  };
  assert.equal(extractOutputText(response), '{"language":"Punjabi"}');
});

test('supports the SDK output_text convenience property', () => {
  assert.equal(extractOutputText({ output_text: 'hello' }), 'hello');
});

test('deduplicates repeated chorus lines and creates small batches', () => {
  const plan = planAnalysis([
    { index: 0, text: 'first' },
    { index: 1, text: 'chorus' },
    { index: 2, text: 'chorus' },
    { index: 3, text: 'last' },
  ], 2);
  assert.deepEqual(plan.uniqueChunks, [
    [{ index: 0, text: 'first' }, { index: 1, text: 'chorus' }],
    [{ index: 3, text: 'last' }],
  ]);
  assert.deepEqual(plan.originals[2], { index: 2, canonicalIndex: 1 });
});

test('requires a per-line language and target-language fit', () => {
  const lineSchema = analysisSchema.properties.lines.items;
  assert.ok(lineSchema.required.includes('language'));
  assert.ok(lineSchema.required.includes('targetLanguageFit'));
  assert.ok(lineSchema.required.includes('wordGlosses'));
  assert.ok(lineSchema.required.includes('romanization'));
  assert.ok(lineSchema.required.includes('dailyAlternativeWordGlosses'));
  assert.ok(lineSchema.properties.wordGlosses.items.required.includes('romanization'));
  assert.deepEqual(lineSchema.properties.targetLanguageFit.enum, ['target', 'mixed', 'other', 'unclear']);
});

test('finds every lyric word missing from model glosses', () => {
  assert.deepEqual(lexicalWords('हाँ, मेरी अखियों से अखियाँ मिला ले'), ['हाँ', 'मेरी', 'अखियों', 'से', 'अखियाँ', 'मिला', 'ले']);
  assert.deepEqual(findMissingGlosses(
    [{ index: 4, text: 'हाँ, मेरी अखियों से अखियाँ मिला ले' }],
    [{ index: 4, wordGlosses: [
      { word: 'हाँ' }, { word: 'मेरी' }, { word: 'से' }, { word: 'मिला' }, { word: 'ले' },
    ] }],
  ), [{ index: 4, text: 'हाँ, मेरी अखियों से अखियाँ मिला ले', words: ['अखियों', 'अखियाँ'], dailyAlternative: '', dailyAlternativeWords: [] }]);
});

test('merges correction glosses into their analyzed lines', () => {
  const batch = { lines: [{ index: 2, wordGlosses: [{ word: 'मेरी' }], dailyAlternativeWordGlosses: [] }] };
  const correction = { lines: [{ index: 2, wordGlosses: [{ word: 'अखियों', romanization: 'akhiyon', meaning: 'eyes' }], dailyAlternativeWordGlosses: [{ word: 'आँखों', romanization: 'aankhon', meaning: 'eyes' }] }] };
  assert.deepEqual(mergeGlossCorrections(batch, correction).lines[0].wordGlosses, [
    { word: 'मेरी' },
    { word: 'अखियों', romanization: 'akhiyon', meaning: 'eyes' },
  ]);
  assert.deepEqual(mergeGlossCorrections(batch, correction).lines[0].dailyAlternativeWordGlosses, [
    { word: 'आँखों', romanization: 'aankhon', meaning: 'eyes' },
  ]);
});

test('finds missing daily-alternative glosses', () => {
  assert.deepEqual(findMissingGlosses(
    [{ index: 7, text: 'poetic line' }],
    [{ index: 7, wordGlosses: [{ word: 'poetic' }, { word: 'line' }], dailyAlternative: 'मेरी आँखों में देखो', dailyAlternativeWordGlosses: [{ word: 'मेरी' }] }],
  )[0].dailyAlternativeWords, ['आँखों', 'में', 'देखो']);
});
