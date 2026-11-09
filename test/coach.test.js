const test = require('node:test');
const assert = require('node:assert/strict');
const { extractOutputText, planAnalysis } = require('../src/coach');

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
