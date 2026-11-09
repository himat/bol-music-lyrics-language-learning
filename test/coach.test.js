const test = require('node:test');
const assert = require('node:assert/strict');
const { extractOutputText } = require('../src/coach');

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
