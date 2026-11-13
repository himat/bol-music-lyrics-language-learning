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
        required: ['index', 'translation', 'romanization', 'language', 'targetLanguageFit', 'register', 'explanation', 'dailyAlternative', 'dailyAlternativeTranslation', 'dailyAlternativeWordGlosses', 'wordGlosses'],
        properties: {
          index: { type: 'integer' },
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
  required: ['nativeScript', 'examples'],
  properties: {
    nativeScript: { type: 'string' },
    examples: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'romanization', 'translation'],
        properties: {
          text: { type: 'string' },
          romanization: { type: 'string' },
          translation: { type: 'string' },
        },
      },
    },
  },
};

const lyricChatSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['answer'],
  properties: { answer: { type: 'string' } },
};

function trimChatHistory(messages, limit = 8) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => ['user', 'assistant'].includes(message?.role) && typeof message?.content === 'string' && message.content.trim())
    .slice(-limit)
    .map(({ role, content }) => ({ role, content: content.trim() }));
}

async function requestStructured({ apiKey, model, instructions, input, name, schema, maxOutputTokens }) {
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
    signal: AbortSignal.timeout(90000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || `OpenAI returned ${response.status}.`);
  const outputText = extractOutputText(body);
  if (!outputText) throw new Error('The language coach returned no analysis.');
  return JSON.parse(outputText);
}

function createCoach({ apiKey, model, targetLanguage }) {
  return {
    async analyze({ track, lines }) {
      const plan = planAnalysis(lines);
      const batches = await Promise.all(plan.uniqueChunks.map(async (compactLines) => {
        let batch = await requestStructured({
          apiKey,
          model,
          instructions: `You are a careful language teacher for an adult learner whose target is ${targetLanguage || 'Hindi'} and whose goal is natural daily conversation, not imitation of song lyrics. Identify the actual language of every individual line; songs often switch among Hindi, Punjabi, Urdu, English, and regional languages. Use only the canonical short language name in the language field, such as Hindi, Punjabi, Urdu, or English—do not append script or transliteration notes. Never call Punjabi or Urdu Hindi just because they share vocabulary. For each line, set targetLanguageFit to target only when it is genuinely ${targetLanguage || 'Hindi'}, mixed when the line itself code-switches between the target and another language, other when it is another language, and unclear when there is not enough evidence. Translate each supplied line into concise natural English. Add a readable Latin-script romanization of the complete original line, preserving any words already written in Latin script. Label its real-world register. Explain idioms, grammar, cultural context, language differences, or song-specific compression in one short sentence. In wordGlosses, cover every individual lexical token in the original line, including pronouns, particles, postpositions, auxiliaries, and short helper verbs such as ले, दे, है, and ना. Each entry must contain exactly one surface word copied without surrounding punctuation, that word's Latin-script romanization, and its short contextual English meaning. Never combine multiple words into one entry. A repeated surface word only needs one entry because it will be reused at every occurrence. Omit only pure punctuation and non-lexical vocalizations. For words already in Latin script, repeat the surface word as the romanization. Before answering, check that every lexical token has a matching wordGlosses entry. For non-target lines, explicitly say that the learner should not treat the phrase as ${targetLanguage || 'Hindi'}. If a line is poetic, uncommon, overly formal, gendered in a relevant way, or unnatural in daily speech, put a genuinely common daily alternative in dailyAlternative, its concise English translation in dailyAlternativeTranslation, and complete per-word romanization/meaning entries in dailyAlternativeWordGlosses following the same one-word rules. Do not put the English translation inside dailyAlternative itself. If it is already natural daily speech, all three daily-alternative fields must be empty (an empty string, an empty string, and an empty array). Never invent certainty. Preserve every input index exactly once and do not quote unrelated lyrics.`,
          input: { track: { title: track.title, artist: track.artist }, lines: compactLines },
          name: 'song_language_coach',
          schema: analysisSchema,
          maxOutputTokens: 6000,
        });
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const missing = findMissingGlosses(compactLines, batch.lines);
          if (!missing.length) break;
          const correction = await requestStructured({
            apiKey,
            model,
            instructions: 'Supply separate word glosses for every requested original and daily-alternative word. Copy each surface word exactly. Never combine words. Return a readable Latin-script romanization and a short contextual English meaning for each one. Use an empty array when a category has no requested words.',
            input: { track: { title: track.title, artist: track.artist }, missing },
            name: 'missing_word_glosses',
            schema: glossCorrectionSchema,
            maxOutputTokens: 3000,
          });
          batch = mergeGlossCorrections(batch, correction);
        }
        return batch;
      }));
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
      return requestStructured({
        apiKey,
        model,
        instructions: `You are creating a flashcard for an adult learning ${targetLanguage || card.language || 'Hindi'} for real daily conversation. Return nativeScript as the supplied word written in the language's normal native script (Devanagari for Hindi), even when the supplied lyric writes it in Latin letters; if it is already in its native script, copy it unchanged. Write exactly three short, natural, distinct conversational examples that teach the supplied word in contexts someone would genuinely say. Avoid song lyrics, poetry, archaic phrasing, and contrived repetition. Each example must contain the word or its grammatically appropriate inflected form. Use the supplied contextual meaning, and preserve the supplied language. Return each example in its native script, a readable Latin-script romanization, and concise natural English. Do not add explanations.`,
        input: {
          word: card.word,
          romanization: card.romanization,
          contextualMeaning: card.meaning,
          language: card.language,
          sourcePhrase: card.context?.text || '',
          sourceTranslation: card.context?.translation || '',
        },
        name: 'flashcard_conversation_examples',
        schema: flashcardExamplesSchema,
        maxOutputTokens: 1200,
      });
    },
    async answerLyricQuestion({ track, focus, nearby, history, question }) {
      return requestStructured({
        apiKey,
        model,
        instructions: `You are a patient language tutor helping an adult learn ${targetLanguage || 'Hindi'} for natural daily conversation. Answer the learner's exact question about the supplied lyric. Use the focused line, its English translation, romanization, per-word meanings, usage analysis, and nearby lines as context. Clearly distinguish Hindi, Punjabi, Urdu, English, and other languages rather than treating similar vocabulary as Hindi. Explain grammar, vocabulary, pronunciation, idiom, cultural context, and whether wording is natural in daily speech when relevant. Include native script, readable romanization, and concise English examples when useful. Be direct and concise. Do not invent facts or quote lyrics beyond the supplied context; say when the supplied context is insufficient.`,
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

function planAnalysis(lines, chunkSize = 12) {
  const textToCanonical = new Map();
  const unique = [];
  const originals = lines.slice(0, 160).map(({ index, text }) => {
    const normalized = String(text).trim();
    if (!textToCanonical.has(normalized)) {
      textToCanonical.set(normalized, index);
      unique.push({ index, text: normalized });
    }
    return { index, canonicalIndex: textToCanonical.get(normalized) };
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

module.exports = { createCoach, analysisSchema, flashcardExamplesSchema, lyricChatSchema, trimChatHistory, extractOutputText, planAnalysis, lexicalWords, findMissingGlosses, mergeGlossCorrections };
