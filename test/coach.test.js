const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoach, extractOutputText, extractCompleteArrayObjects, planAnalysis, analysisSchema, translationSchema, flashcardExamplesSchema, lyricChatSchema, trimChatHistory, lexicalWords, findMissingGlosses, mergeGlossCorrections, findMissingExampleGlosses, mergeExampleGlossCorrections, reconcileTargetLanguageFits, retryTransientAnalysis } = require('../src/coach');

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

test('publishes the current line and repeated occurrences before slower batches finish', async () => {
  const originalFetch = global.fetch;
  let releaseSlow;
  const slow = new Promise((resolve) => { releaseSlow = resolve; });
  let signalProgress;
  const firstProgress = new Promise((resolve) => { signalProgress = resolve; });
  const requests = [];
  let active = 0;
  let maxActive = 0;
  global.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const input = JSON.parse(request.input);
    requests.push(input.lines.map((line) => line.index));
    maxActive = Math.max(maxActive, ++active);
    if (input.lines[0].index !== 7) await slow;
    active -= 1;
    return { ok: true, json: async () => ({ output_text: JSON.stringify({
      language: 'Hindi', summary: '', lines: input.lines.map(({ index, text }) => ({
        index, translation: text, wordGlosses: [{ word: text, romanization: text, meaning: text }],
      })),
    }) }) };
  };
  const lines = Array.from({ length: 24 }, (_, index) => ({ index, text: `word${index}` }));
  lines.push({ index: 24, text: 'word7' });
  let finished = false;
  try {
    const pending = createCoach({ apiKey: 'test' }).analyze({ track: {}, lines, priorityIndex: 24 }, (progress) => signalProgress(progress));
    pending.then(() => { finished = true; });
    const progress = await firstProgress;
    assert.deepEqual(requests[0], [7]);
    assert.equal(finished, false);
    assert.deepEqual(progress.lines.map(({ index }) => index), [7, 24]);
    assert.equal(progress.total, 25);
    releaseSlow();
    const result = await pending;
    assert.equal(result.lines.length, 25);
    assert.ok(maxActive <= 3);
  } finally { releaseSlow(); global.fetch = originalFetch; }
});

test('publishes usable coaching before waiting for missing gloss repairs', async () => {
  const originalFetch = global.fetch;
  let releaseRepair;
  const repairWait = new Promise((resolve) => { releaseRepair = resolve; });
  const progress = [];
  global.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    if (request.text.format.name === 'missing_word_glosses') {
      assert.equal(progress.length, 1);
      await repairWait;
      return { ok: true, json: async () => ({ output_text: JSON.stringify({ lines: [
        { index: 0, wordGlosses: [{ word: 'hello', romanization: 'hello', meaning: 'greeting' }], dailyAlternativeWordGlosses: [] },
      ] }) }) };
    }
    return { ok: true, json: async () => ({ output_text: JSON.stringify({
      language: 'English', summary: '', lines: [{ index: 0, translation: 'hello', wordGlosses: [], dailyAlternativeWordGlosses: [] }],
    }) }) };
  };
  try {
    const pending = createCoach({ apiKey: 'test' }).analyze({ track: {}, lines: [{ index: 0, text: 'hello' }] }, (event) => {
      progress.push(event);
      if (progress.length === 1) releaseRepair();
    });
    const result = await pending;
    assert.equal(progress.length, 2);
    assert.equal(result.lines[0].wordGlosses[0].meaning, 'greeting');
  } finally { releaseRepair(); global.fetch = originalFetch; }
});

test('keeps publishing successful batches when another batch fails', async () => {
  const originalFetch = global.fetch;
  const progress = [];
  global.fetch = async (_url, options) => {
    const { lines } = JSON.parse(JSON.parse(options.body).input);
    if (lines[0].index === 0) return { ok: false, status: 400, json: async () => ({ error: { message: 'Batch rejected' } }) };
    return { ok: true, json: async () => ({ output_text: JSON.stringify({ language: 'Hindi', summary: '',
      lines: lines.map(({ index, text }) => ({ index, translation: text, wordGlosses: [{ word: text }] })),
    }) }) };
  };
  try {
    const lines = Array.from({ length: 13 }, (_, index) => ({ index, text: `word${index}` }));
    await assert.rejects(createCoach({ apiKey: 'test' }).analyze({ track: {}, lines }, (event) => progress.push(event)), /Batch rejected/);
    assert.equal(progress.at(-1).completed, 7);
    assert.deepEqual(progress.at(-1).lines.map(({ index }) => index), [6, 7, 8, 9, 10, 11, 12]);
  } finally { global.fetch = originalFetch; }
});

test('cancels old analysis without starting queued batches or publishing late progress', async () => {
  const originalFetch = global.fetch;
  const controller = new AbortController();
  let calls = 0;
  const progress = [];
  global.fetch = async (_url, options) => {
    calls += 1;
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  };
  try {
    const lines = Array.from({ length: 30 }, (_, index) => ({ index, text: `word${index}` }));
    const pending = createCoach({ apiKey: 'test' }).analyze({ track: {}, lines }, (event) => progress.push(event), controller.signal);
    controller.abort();
    await assert.rejects(pending);
    assert.equal(calls, 3);
    assert.equal(progress.length, 0);
  } finally { controller.abort(); global.fetch = originalFetch; }
});

test('retries one transient analysis failure before succeeding', async () => {
  let attempts = 0;
  const result = await retryTransientAnalysis(async () => {
    attempts += 1;
    if (attempts === 1) throw new DOMException('The operation timed out', 'TimeoutError');
    return 'complete';
  });

  assert.equal(result, 'complete');
  assert.equal(attempts, 2);
});

test('does not retry a permanent analysis failure', async () => {
  let attempts = 0;
  await assert.rejects(() => retryTransientAnalysis(async () => {
    attempts += 1;
    const error = new Error('Incorrect API key');
    error.status = 401;
    throw error;
  }), /Incorrect API key/);
  assert.equal(attempts, 1);
});

test('retries an omitted-line repair failure', async () => {
  let attempts = 0;
  const result = await retryTransientAnalysis(async () => {
    attempts += 1;
    if (attempts === 1) {
      const error = new Error('The language coach skipped lyric line 6.');
      error.transient = true;
      throw error;
    }
    return { index: 5 };
  });

  assert.deepEqual(result, { index: 5 });
  assert.equal(attempts, 2);
});

test('reconciles contradictory language fit values with the selected target', () => {
  const analysis = reconcileTargetLanguageFits({ lines: [
    { index: 0, language: 'Hindi', targetLanguageFit: 'other' },
    { index: 1, language: 'Punjabi', targetLanguageFit: 'target' },
    { index: 2, language: 'Hindi', targetLanguageFit: 'mixed' },
    { index: 3, language: '', targetLanguageFit: 'unclear' },
  ] }, 'Hindi');
  assert.deepEqual(analysis.lines.map((line) => line.targetLanguageFit), ['target', 'other', 'mixed', 'unclear']);
});

test('requires complete normalized vocabulary, word glosses, and three examples', () => {
  assert.deepEqual(flashcardExamplesSchema.required, ['nativeScript', 'romanization', 'meaning', 'language', 'wordGlosses', 'examples']);
  assert.deepEqual(flashcardExamplesSchema.properties.wordGlosses.items.required, ['word', 'romanization', 'meaning']);
  assert.equal(flashcardExamplesSchema.properties.examples.minItems, 3);
  assert.equal(flashcardExamplesSchema.properties.examples.maxItems, 3);
  assert.deepEqual(flashcardExamplesSchema.properties.examples.items.required, ['text', 'romanization', 'translation', 'wordGlosses']);
  assert.deepEqual(flashcardExamplesSchema.properties.examples.items.properties.wordGlosses.items.required, ['word', 'romanization', 'meaning']);
});

test('keeps the fast translation response minimal', () => {
  assert.deepEqual(translationSchema.required, ['lines']);
  assert.deepEqual(translationSchema.properties.lines.items.required, ['index', 'translation']);
  assert.deepEqual(Object.keys(translationSchema.properties.lines.items.properties), ['index', 'translation']);
});

test('extracts only complete translation objects from streamed structured output', () => {
  const partial = '{"lines":[{"index":0,"translation":"Hello, {friend} — \\"yes\\"."},{"index":1,"translation":"Still arriv';
  assert.deepEqual(extractCompleteArrayObjects(partial, 'lines'), [
    { index: 0, translation: 'Hello, {friend} — "yes".' },
  ]);
});

test('streams completed translations before returning the full song', async () => {
  const originalFetch = global.fetch;
  const encoder = new TextEncoder();
  const deltas = [
    '{"lines":[{"index":0,"translation":"First"}',
    ',{"index":1,"translation":"Chorus"}]}',
  ];
  global.fetch = async (_url, options) => {
    assert.equal(JSON.parse(options.body).stream, true);
    return new Response(new ReadableStream({
      start(controller) {
        for (const delta of deltas) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta })}\n\n`));
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'response.completed' })}\n\n`));
        controller.close();
      },
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const progress = [];
    const result = await createCoach({ apiKey: 'test', model: 'gpt-4o-mini', targetLanguage: 'Hindi' }).translate({
      track: { title: 'Test', artist: 'Singer' },
      lines: [{ index: 0, text: 'first' }, { index: 1, text: 'chorus' }, { index: 2, text: 'chorus' }],
    }, (update) => progress.push(update.lines));
    assert.deepEqual(progress, [
      [{ index: 0, translation: 'First' }],
      [{ index: 1, translation: 'Chorus' }, { index: 2, translation: 'Chorus' }],
    ]);
    assert.deepEqual(result.lines, [
      { index: 0, translation: 'First' },
      { index: 1, translation: 'Chorus' },
      { index: 2, translation: 'Chorus' },
    ]);
  } finally {
    global.fetch = originalFetch;
  }
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

test('uses six-line batches and deduplicates cosmetic lyric differences', () => {
  const lines = Array.from({ length: 8 }, (_, index) => ({ index, text: `line ${index}` }));
  lines.push({ index: 8, text: '  LINE 1  ' });
  lines.push({ index: 9, text: 'line 2 ,' });
  lines.push({ index: 10, text: 'line 2,' });
  const plan = planAnalysis(lines);
  assert.equal(plan.uniqueChunks[0].length, 6);
  assert.equal(plan.uniqueChunks[1].length, 3);
  assert.equal(plan.originals[8].canonicalIndex, 1);
  assert.equal(plan.originals[10].canonicalIndex, 9);
});

test('requires a per-line language and target-language fit', () => {
  const lineSchema = analysisSchema.properties.lines.items;
  assert.ok(lineSchema.required.includes('language'));
  assert.ok(lineSchema.required.includes('targetLanguageFit'));
  assert.ok(lineSchema.required.includes('wordGlosses'));
  assert.ok(lineSchema.required.includes('nativeScript'));
  assert.ok(lineSchema.required.includes('romanization'));
  assert.ok(lineSchema.required.includes('dailyAlternativeWordGlosses'));
  assert.ok(lineSchema.properties.wordGlosses.items.required.includes('romanization'));
  assert.deepEqual(lineSchema.properties.targetLanguageFit.enum, ['target', 'mixed', 'other', 'unclear']);
});

test('keeps only recent valid turns for lyric chat context', () => {
  const messages = [
    { role: 'system', content: 'ignore' },
    { role: 'user', content: '  first  ' },
    { role: 'assistant', content: 'answer' },
    { role: 'user', content: '' },
    { role: 'user', content: 'latest' },
  ];
  assert.deepEqual(trimChatHistory(messages, 2), [
    { role: 'assistant', content: 'answer' },
    { role: 'user', content: 'latest' },
  ]);
  assert.deepEqual(lyricChatSchema.required, ['answer', 'languageBlocks']);
  assert.equal(lyricChatSchema.additionalProperties, false);
  assert.deepEqual(lyricChatSchema.properties.languageBlocks.items.required, ['label', 'nativeScript', 'romanization', 'translation']);
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

test('repairs helper words omitted from generated example glosses', () => {
  const generated = { examples: [{
    text: 'तुम मेरी जानाँ हो।',
    wordGlosses: [{ word: 'तुम' }, { word: 'मेरी' }, { word: 'जानाँ' }],
  }] };
  assert.deepEqual(findMissingExampleGlosses(generated.examples), [
    { index: 0, text: 'तुम मेरी जानाँ हो।', words: ['हो'] },
  ]);
  assert.deepEqual(mergeExampleGlossCorrections(generated, {
    examples: [{ index: 0, wordGlosses: [{ word: 'हो', romanization: 'ho', meaning: 'are' }] }],
  }).examples[0].wordGlosses.at(-1), { word: 'हो', romanization: 'ho', meaning: 'are' });
});
