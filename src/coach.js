const analysisSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['language', 'summary', 'lines'],
  properties: {
    language: { type: 'string' },
    summary: { type: 'string' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'nativeScript', 'translation', 'romanization', 'language', 'targetLanguageFit', 'register', 'explanation', 'dailyAlternative', 'dailyAlternativeTranslation', 'dailyAlternativeWordGlosses', 'wordGlosses'],
        properties: {
          index: { type: 'integer' },
          nativeScript: { type: 'string' },
          translation: { type: 'string' },
          romanization: { type: 'string' },
          language: { type: 'string' },
          targetLanguageFit: { type: 'string', enum: ['target', 'mixed', 'other', 'unclear'] },
          register: { type: 'string', enum: ['common', 'casual', 'formal', 'poetic', 'uncommon', 'unclear'] },
          explanation: { type: 'string' },
          dailyAlternative: { type: 'string' },
          dailyAlternativeTranslation: { type: 'string' },
          dailyAlternativeWordGlosses: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['word', 'romanization', 'meaning'],
              properties: { word: { type: 'string' }, romanization: { type: 'string' }, meaning: { type: 'string' } },
            },
          },
          wordGlosses: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['word', 'romanization', 'meaning'],
              properties: { word: { type: 'string' }, romanization: { type: 'string' }, meaning: { type: 'string' } },
            },
          },
        },
      },
    },
  },
};

const translationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['lines'],
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'translation'],
        properties: { index: { type: 'integer' }, translation: { type: 'string' } },
      },
    },
  },
};

const wordGlossSchema = analysisSchema.properties.lines.items.properties.wordGlosses;
const glossCorrectionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['lines'],
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'wordGlosses', 'dailyAlternativeWordGlosses'],
        properties: { index: { type: 'integer' }, wordGlosses: wordGlossSchema, dailyAlternativeWordGlosses: wordGlossSchema },
      },
    },
  },
};

const flashcardExamplesSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['nativeScript', 'romanization', 'meaning', 'language', 'wordGlosses', 'examples'],
  properties: {
    nativeScript: { type: 'string' },
    romanization: { type: 'string' },
    meaning: { type: 'string' },
    language: { type: 'string' },
    wordGlosses: wordGlossSchema,
    examples: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'romanization', 'translation', 'wordGlosses'],
        properties: {
          text: { type: 'string' },
          romanization: { type: 'string' },
          translation: { type: 'string' },
          wordGlosses: wordGlossSchema,
        },
      },
    },
  },
};

const exampleGlossCorrectionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['examples'],
  properties: {
    examples: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'wordGlosses'],
        properties: { index: { type: 'integer' }, wordGlosses: wordGlossSchema },
      },
    },
  },
};

const lyricChatSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'languageBlocks'],
  properties: {
    answer: { type: 'string' },
    languageBlocks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'nativeScript', 'romanization', 'translation'],
        properties: {
          label: { type: 'string' },
          nativeScript: { type: 'string' },
          romanization: { type: 'string' },
          translation: { type: 'string' },
        },
      },
    },
  },
};

function trimChatHistory(messages, limit = 8) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => ['user', 'assistant'].includes(message?.role) && typeof message?.content === 'string' && message.content.trim())
    .slice(-limit)
    .map(({ role, content }) => ({ role, content: content.trim() }));
}

async function requestStructured(options) {
  const startedAt = Date.now();
  try {
    const result = await requestStructuredResponse(options);
    console.info('[coach] request complete', { kind: options.name, elapsedMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    console.info('[coach] request failed', { kind: options.name, elapsedMs: Date.now() - startedAt, status: error.status || error.name });
    throw error;
  }
}

async function requestStructuredResponse({ apiKey, model, instructions, input, name, schema, maxOutputTokens, timeoutMs = 60000, signal }) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      store: false,
      instructions,
      input: JSON.stringify(input),
      text: { format: { type: 'json_schema', name, strict: true, schema } },
      max_output_tokens: maxOutputTokens,
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error?.message || `OpenAI returned ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  const outputText = extractOutputText(body);
  if (!outputText) throw new Error('The language coach returned no analysis.');
  return JSON.parse(outputText);
}

function isTransientAnalysisError(error) {
  if (error?.transient) return true;
  const status = Number(error?.status || 0);
  if ([408, 409, 429].includes(status) || status >= 500) return true;
  if (['AbortError', 'TimeoutError', 'SyntaxError'].includes(error?.name)) return true;
  return /timed?\s*out|network|fetch failed|connection|no analysis|unexpected end|invalid json/i.test(String(error?.message || ''));
}

async function retryTransientAnalysis(operation, attempts = 2) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt + 1 >= attempts || !isTransientAnalysisError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
  throw lastError;
}

function extractCompleteArrayObjects(text, propertyName) {
  const propertyAt = String(text).indexOf(`"${propertyName}"`);
  if (propertyAt < 0) return [];
  const arrayAt = String(text).indexOf('[', propertyAt);
  if (arrayAt < 0) return [];
  const objects = [];
  let objectStart = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = arrayAt + 1; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{') {
      if (depth === 0) objectStart = index;
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0 && objectStart >= 0) {
        try { objects.push(JSON.parse(text.slice(objectStart, index + 1))); } catch {}
        objectStart = -1;
      }
    } else if (character === ']' && depth === 0) {
      break;
    }
  }
  return objects;
}

async function readSSE(body, onEvent) {
  if (!body) throw new Error('The language coach returned no response stream.');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const consume = (final = false) => {
    buffer += final ? decoder.decode() : '';
    buffer = buffer.replace(/\r\n/g, '\n');
    if (final && buffer.trim() && !buffer.endsWith('\n\n')) buffer += '\n\n';
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
      if (data && data !== '[DONE]') onEvent(JSON.parse(data));
      boundary = buffer.indexOf('\n\n');
    }
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      consume();
    }
    consume(true);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
}

async function requestStructuredStream({ apiKey, model, instructions, input, name, schema, maxOutputTokens, timeoutMs = 60000, onTextDelta, signal }) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      store: false,
      stream: true,
      instructions,
      input: JSON.stringify(input),
      text: { format: { type: 'json_schema', name, strict: true, schema } },
      max_output_tokens: maxOutputTokens,
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error?.message || `OpenAI returned ${response.status}.`);
  }
  let outputText = '';
  await readSSE(response.body, (event) => {
    if (event.type === 'response.output_text.delta') {
      outputText += event.delta || '';
      onTextDelta?.(outputText);
    } else if (event.type === 'error' || event.type === 'response.failed') {
      throw new Error(event.error?.message || event.response?.error?.message || event.message || 'The language coach stream failed.');
    }
  });
  if (!outputText) throw new Error('The language coach returned no analysis.');
  return JSON.parse(outputText);
}

function createCoach({ apiKey, model, targetLanguage }) {
  return {
    async translate({ track, lines }, onProgress, signal) {
      const plan = planAnalysis(lines, 20);
      const batches = await Promise.all(plan.uniqueChunks.map((compactLines) => {
        const emitted = new Set();
        return requestStructuredStream({
          apiKey,
          model,
          instructions: 'Translate every supplied lyric line into concise, natural English. Preserve every input index exactly once. Return only the translations; do not explain, romanize, classify, or add vocabulary notes.',
          input: { track: { title: track.title, artist: track.artist }, lines: compactLines },
          name: 'song_english_translations',
          schema: translationSchema,
          maxOutputTokens: 1600,
          timeoutMs: 30000,
          signal,
          onTextDelta: (partialText) => {
            const completed = extractCompleteArrayObjects(partialText, 'lines').filter((line) => !emitted.has(line.index));
            if (!completed.length) return;
            completed.forEach((line) => emitted.add(line.index));
            const translations = [];
            for (const line of completed) {
              for (const original of plan.originals) {
                if (original.canonicalIndex === line.index) translations.push({ index: original.index, translation: line.translation });
              }
            }
            if (translations.length) onProgress?.({ lines: translations });
          },
        });
      }));
      const byCanonicalIndex = new Map(batches.flatMap((batch) => batch.lines).map((line) => [line.index, line.translation]));
      return {
        lines: plan.originals.map(({ index, canonicalIndex }) => ({
          index,
          translation: byCanonicalIndex.get(canonicalIndex) || '',
        })),
      };
    },
    async analyze({ track, lines, priorityIndex }, onProgress, signal) {
      const requestAnalysis = async (options) => {
        try {
          signal?.throwIfAborted();
          return await requestStructured({ ...options, signal });
        } catch (error) {
          if (signal?.aborted) throw new Error('Analysis canceled after changing songs.');
          throw error;
        }
      };
      const plan = planAnalysis(lines);
      const priorityCanonical = plan.originals.find((line) => line.index === priorityIndex)?.canonicalIndex;
      const unique = plan.uniqueChunks.flat();
      const priorityLine = unique.find((line) => line.index === priorityCanonical);
      const remaining = unique.filter((line) => line !== priorityLine);
      const chunks = priorityLine ? [[priorityLine]] : [];
      for (let index = 0; index < remaining.length; index += 6) chunks.push(remaining.slice(index, index + 6));
      const available = new Map();
      const publish = (batch) => {
        for (const line of batch.lines || []) available.set(line.index, line);
        const ready = plan.originals.flatMap(({ index, canonicalIndex }) => {
          const line = available.get(canonicalIndex);
          return line ? [{ ...line, index }] : [];
        });
        if (!signal?.aborted) onProgress?.({ lines: ready, completed: ready.length, total: plan.originals.length });
      };
      const analyzeBatch = async (compactLines) => {
        const startedAt = Date.now();
        let batch = await retryTransientAnalysis(() => requestAnalysis({
          apiKey,
          model,
          instructions: `You are a careful language teacher for an adult learner whose target is ${targetLanguage || 'Hindi'} and whose goal is natural daily conversation, not imitation of song lyrics. Identify the actual language of every individual line; songs often switch among Hindi, Punjabi, Urdu, English, and regional languages. Use only the canonical short language name in the language field, such as Hindi, Punjabi, Urdu, or English—do not append script or transliteration notes. Never call Punjabi or Urdu Hindi just because they share vocabulary. For every line, return nativeScript as the complete original wording in its normal native script: use Devanagari for Hindi even when the supplied lyric is written in Latin transliteration, Gurmukhi for Punjabi, Perso-Arabic script for Urdu, and unchanged Latin text for English. For each line, set targetLanguageFit to target only when it is genuinely ${targetLanguage || 'Hindi'}, mixed when the line itself code-switches between the target and another language, other when it is another language, and unclear only for a non-lexical fragment with no usable language signal. A complete grammatical sentence must never be marked unclear: classify it from its vocabulary, grammar, script, and the nearby supplied lines. Translate each supplied line into concise natural English. Add a readable Latin-script romanization of the complete original line, preserving any words already written in Latin script. Label its real-world register. Explain idioms, grammar, cultural context, language differences, or song-specific compression in one short sentence. In wordGlosses, cover every individual lexical token in the original line, including pronouns, particles, postpositions, auxiliaries, and short helper verbs such as ले, दे, है, and ना. Each entry must contain exactly one surface word copied without surrounding punctuation, that word's Latin-script romanization, and its short contextual English meaning. Never combine multiple words into one entry. A repeated surface word only needs one entry because it will be reused at every occurrence. Omit only pure punctuation and non-lexical vocalizations. For words already in Latin script, repeat the surface word as the romanization. Before answering, check that every lexical token has a matching wordGlosses entry. For non-target lines, explicitly say that the learner should not treat the phrase as ${targetLanguage || 'Hindi'}. If a line is poetic, uncommon, overly formal, gendered in a relevant way, or unnatural in daily speech, put a genuinely common daily alternative in dailyAlternative, its concise English translation in dailyAlternativeTranslation, and complete per-word romanization/meaning entries in dailyAlternativeWordGlosses following the same one-word rules. Do not put the English translation inside dailyAlternative itself. If it is already natural daily speech, all three daily-alternative fields must be empty (an empty string, an empty string, and an empty array). Never invent certainty when the text is genuinely ambiguous. Preserve every input index exactly once and do not quote unrelated lyrics.`,
          input: { track: { title: track.title, artist: track.artist }, lines: compactLines },
          name: 'song_language_coach',
          schema: analysisSchema,
          maxOutputTokens: 6000,
        }));
        publish(batch);
        console.info('[coach] batch available', { lineCount: compactLines.length, elapsedMs: Date.now() - startedAt });
        const returnedIndexes = new Set((batch.lines || []).map((line) => line.index));
        const omittedLines = compactLines.filter((line) => !returnedIndexes.has(line.index));
        if (omittedLines.length) {
          const recoveredLines = await Promise.all(omittedLines.map((omittedLine) => retryTransientAnalysis(async () => {
            const repair = await requestAnalysis({
              apiKey,
              model,
              instructions: `Analyze exactly the one omitted lyric line for an adult learner whose target language is ${targetLanguage || 'Hindi'}. Identify its actual language; return its complete wording in the normal native script, concise English translation, readable Latin romanization, real-world register, and a short usage explanation. Set targetLanguageFit relative to ${targetLanguage || 'Hindi'}. Include a separate word gloss for every lexical token. If the lyric is not natural daily speech, include a common daily alternative with its English translation and complete word glosses; otherwise leave all daily-alternative fields empty. Preserve the supplied index exactly and return no unrelated lines.`,
              input: { track: { title: track.title, artist: track.artist }, lines: [omittedLine] },
              name: 'song_language_coach_line_repair',
              schema: analysisSchema,
              maxOutputTokens: 2400,
            });
            const recovered = repair.lines?.find((line) => line.index === omittedLine.index);
            if (!recovered) {
              const error = new Error(`The language coach skipped lyric line ${omittedLine.index + 1}.`);
              error.transient = true;
              throw error;
            }
            return recovered;
          })));
          batch = { ...batch, lines: [...batch.lines, ...recoveredLines] };
          publish(batch);
        }
        for (let attempt = 0; attempt < 1; attempt += 1) {
          const missing = findMissingGlosses(compactLines, batch.lines);
          if (!missing.length) break;
          const correction = await retryTransientAnalysis(() => requestAnalysis({
            apiKey,
            model,
            instructions: 'Supply separate word glosses for every requested original and daily-alternative word. Copy each surface word exactly. Never combine words. Return a readable Latin-script romanization and a short contextual English meaning for each one. Use an empty array when a category has no requested words.',
            input: { track: { title: track.title, artist: track.artist }, missing },
            name: 'missing_word_glosses',
            schema: glossCorrectionSchema,
            maxOutputTokens: 3000,
          }));
          batch = mergeGlossCorrections(batch, correction);
          publish(batch);
        }
        console.info('[coach] batch complete', { lineCount: compactLines.length, elapsedMs: Date.now() - startedAt });
        return batch;
      };
      let nextChunk = 0;
      const batches = new Array(chunks.length);
      const failures = [];
      await Promise.all(Array.from({ length: Math.min(3, chunks.length) }, async () => {
        while (nextChunk < chunks.length) {
          signal?.throwIfAborted();
          const index = nextChunk++;
          try { batches[index] = await analyzeBatch(chunks[index]); }
          catch (error) { failures.push(error); }
        }
      }));
      if (failures.length) throw failures[0];
      const byCanonicalIndex = new Map(batches.flatMap((batch) => batch.lines).map((line) => [line.index, line]));
      return {
        language: batches[0]?.language || targetLanguage || 'Unknown',
        summary: batches.map((batch) => batch.summary).filter(Boolean).join(' '),
        lines: plan.originals.map(({ index, canonicalIndex }) => {
          const result = byCanonicalIndex.get(canonicalIndex);
          if (!result) throw new Error(`The language coach skipped lyric line ${index + 1}.`);
          return { ...result, index };
        }),
      };
    },
    async generateFlashcardExamples(card) {
      let generated = await requestStructured({
        apiKey,
        model,
        instructions: `You are creating a saved-vocabulary card for an adult learning ${targetLanguage || card.language || 'Hindi'} for real daily conversation. The saved item may be a single word or a complete phrase, and it may be supplied in native script, Latin-script transliteration, or English. Return nativeScript as the natural ${targetLanguage || card.language || 'target-language'} word or phrase in its normal native script (Devanagari for Hindi). If the input is English, translate it into a natural everyday expression rather than transliterating the English. Return a readable Latin-script romanization of the full item, its concise natural English meaning, and the canonical short language name. Romanization must be entirely lowercase, including its first word. In wordGlosses, cover every lexical word in nativeScript with its exact surface form, lowercase romanization, and short contextual English meaning. Write exactly three short, distinct example sentences that someone would genuinely say in ordinary life. Avoid song lyrics, poetry, archaic language, textbook contrivances, and unnatural repetition. Each example must naturally use the saved item or a grammatically appropriate inflected variation. Return each example in native script, an entirely lowercase Latin-script romanization, and concise natural English. In each example's wordGlosses, cover every lexical word in that example with its exact surface form, lowercase romanization, and short contextual English meaning. Never combine multiple source words into one gloss. Do not add explanations.`,
        input: {
          kind: card.kind || 'word',
          word: card.word,
          romanization: card.romanization,
          contextualMeaning: card.meaning,
          language: card.language,
          sourcePhrase: card.context?.text || '',
          sourceTranslation: card.context?.translation || '',
        },
        name: 'flashcard_conversation_examples',
        schema: flashcardExamplesSchema,
        maxOutputTokens: 2200,
      });
      const missing = findMissingExampleGlosses(generated.examples);
      if (missing.length) {
        const correction = await requestStructured({
          apiKey,
          model,
          instructions: 'Supply a separate gloss for every requested word from each example. Copy each source word exactly without punctuation. Return its lowercase Latin-script romanization and short contextual English meaning. Never combine words.',
          input: { examples: missing },
          name: 'missing_example_word_glosses',
          schema: exampleGlossCorrectionSchema,
          maxOutputTokens: 1600,
        });
        generated = mergeExampleGlossCorrections(generated, correction);
      }
      return generated;
    },
    async answerLyricQuestion({ track, focus, nearby, history, question }) {
      return requestStructured({
        apiKey,
        model,
        instructions: `You are a patient language tutor helping an adult learn ${targetLanguage || 'Hindi'} for natural daily conversation. Answer the learner's exact question about the supplied lyric. Use the focused line, its native script, English translation, romanization, per-word meanings, usage analysis, and nearby lines as context. Clearly distinguish Hindi, Punjabi, Urdu, English, and other languages rather than treating similar vocabulary as Hindi. Explain grammar, vocabulary, pronunciation, idiom, cultural context, and whether wording is natural in daily speech when relevant. The answer field must contain concise English-only explanation: never put a Hindi word, transliteration, example, corrected phrase, or dialogue turn in answer. Put every target-language item in languageBlocks. Every language block must be ordered and populated as: nativeScript first (Devanagari for Hindi, even when the source is Latin transliteration), romanization second, and concise natural English translation third. For a conversation, return one block per speaker turn and put the speaker name such as A or B in label. For vocabulary or grammar explanations, return one block for every word or phrase you mention. Use an empty languageBlocks array only when the answer genuinely contains no target-language item. Be direct and concise. Do not use Markdown headings, bold markers, or tables in answer. Do not invent facts or quote lyrics beyond the supplied context; say when the supplied context is insufficient.`,
        input: {
          track: { title: track?.title || '', artist: track?.artist || '' },
          focus,
          nearby,
          conversation: trimChatHistory(history),
          question: String(question || '').trim(),
        },
        name: 'lyric_tutor_answer',
        schema: lyricChatSchema,
        maxOutputTokens: 1200,
      });
    },
  };
}

function normalizedWord(value) {
  return String(value || '').normalize('NFKC').replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '').toLocaleLowerCase();
}

function lexicalWords(text) {
  const words = [];
  const seen = new Set();
  for (const { segment, isWordLike } of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(String(text))) {
    const normalized = isWordLike ? normalizedWord(segment) : '';
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    words.push(segment);
  }
  return words;
}

function findMissingGlosses(sourceLines, analyzedLines) {
  const analysisByIndex = new Map((analyzedLines || []).map((line) => [line.index, line]));
  return sourceLines.flatMap((line) => {
    const analysis = analysisByIndex.get(line.index);
    const existing = new Set((analysis?.wordGlosses || []).map((gloss) => normalizedWord(gloss.word)));
    const words = lexicalWords(line.text).filter((word) => !existing.has(normalizedWord(word)));
    const alternativeExisting = new Set((analysis?.dailyAlternativeWordGlosses || []).map((gloss) => normalizedWord(gloss.word)));
    const dailyAlternativeWords = lexicalWords(analysis?.dailyAlternative || '').filter((word) => !alternativeExisting.has(normalizedWord(word)));
    return words.length || dailyAlternativeWords.length
      ? [{ index: line.index, text: line.text, words, dailyAlternative: analysis?.dailyAlternative || '', dailyAlternativeWords }]
      : [];
  });
}

function mergeGlossCorrections(batch, correction) {
  const additions = new Map((correction?.lines || []).map((line) => [line.index, line]));
  return {
    ...batch,
    lines: batch.lines.map((line) => {
      const correctionLine = additions.get(line.index);
      return {
        ...line,
        wordGlosses: [...line.wordGlosses, ...(correctionLine?.wordGlosses || [])],
        dailyAlternativeWordGlosses: [...line.dailyAlternativeWordGlosses, ...(correctionLine?.dailyAlternativeWordGlosses || [])],
      };
    }),
  };
}

function canonicalLanguageName(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase()
    .replace(/\s*\([^)]*\)\s*$/, '');
}

function reconcileTargetLanguageFits(analysis, targetLanguage) {
  if (!analysis?.lines?.length) return analysis;
  const target = canonicalLanguageName(targetLanguage);
  return {
    ...analysis,
    lines: analysis.lines.map((line) => {
      if (line.targetLanguageFit === 'mixed') return line;
      const language = canonicalLanguageName(line.language);
      if (!target || !language || ['unknown', 'unclear'].includes(language)) return line;
      const targetLanguageFit = language === target ? 'target' : 'other';
      return targetLanguageFit === line.targetLanguageFit ? line : { ...line, targetLanguageFit };
    }),
  };
}

function findMissingExampleGlosses(examples = []) {
  return examples.map((example, index) => {
    const covered = new Set((example.wordGlosses || []).map((gloss) => analysisLineKey(gloss.word)));
    return {
      index,
      text: example.text,
      words: lexicalWords(example.text).filter((word) => !covered.has(analysisLineKey(word))),
    };
  }).filter((example) => example.words.length);
}

function mergeExampleGlossCorrections(generated, correction) {
  const additions = new Map((correction.examples || []).map((example) => [example.index, example.wordGlosses || []]));
  return {
    ...generated,
    examples: (generated.examples || []).map((example, index) => ({
      ...example,
      wordGlosses: [...(example.wordGlosses || []), ...(additions.get(index) || [])],
    })),
  };
}

function analysisLineKey(text) {
  return String(text || '').normalize('NFKC').trim().toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s+([,!?।])/g, '$1');
}

function planAnalysis(lines, chunkSize = 6) {
  const textToCanonical = new Map();
  const unique = [];
  const originals = lines.slice(0, 160).map(({ index, text }) => {
    const normalized = String(text).trim();
    const key = analysisLineKey(normalized);
    if (!textToCanonical.has(key)) {
      textToCanonical.set(key, index);
      unique.push({ index, text: normalized });
    }
    return { index, canonicalIndex: textToCanonical.get(key) };
  });
  const uniqueChunks = [];
  for (let index = 0; index < unique.length; index += chunkSize) uniqueChunks.push(unique.slice(index, index + chunkSize));
  return { originals, uniqueChunks };
}

function extractOutputText(response) {
  if (typeof response?.output_text === 'string') return response.output_text;
  return (response?.output || [])
    .flatMap((item) => item?.content || [])
    .filter((content) => content?.type === 'output_text' && typeof content.text === 'string')
    .map((content) => content.text)
    .join('');
}

module.exports = { createCoach, analysisSchema, translationSchema, flashcardExamplesSchema, lyricChatSchema, trimChatHistory, extractOutputText, extractCompleteArrayObjects, planAnalysis, analysisLineKey, lexicalWords, findMissingGlosses, mergeGlossCorrections, findMissingExampleGlosses, mergeExampleGlossCorrections, reconcileTargetLanguageFits, isTransientAnalysisError, retryTransientAnalysis };
