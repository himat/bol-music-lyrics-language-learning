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
        required: ['index', 'translation', 'language', 'targetLanguageFit', 'register', 'explanation', 'dailyAlternative', 'wordGlosses'],
        properties: {
          index: { type: 'integer' },
          translation: { type: 'string' },
          language: { type: 'string' },
          targetLanguageFit: { type: 'string', enum: ['target', 'mixed', 'other', 'unclear'] },
          register: { type: 'string', enum: ['common', 'casual', 'formal', 'poetic', 'uncommon', 'unclear'] },
          explanation: { type: 'string' },
          dailyAlternative: { type: 'string' },
          wordGlosses: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['word', 'meaning'],
              properties: { word: { type: 'string' }, meaning: { type: 'string' } },
            },
          },
        },
      },
    },
  },
};

function createCoach({ apiKey, model, targetLanguage }) {
  return {
    async analyze({ track, lines }) {
      const plan = planAnalysis(lines);
      const batches = await Promise.all(plan.uniqueChunks.map(async (compactLines) => {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model || 'gpt-4o-mini',
          store: false,
          instructions: `You are a careful language teacher for an adult learner whose target is ${targetLanguage || 'Hindi'} and whose goal is natural daily conversation, not imitation of song lyrics. Identify the actual language of every individual line; songs often switch among Hindi, Punjabi, Urdu, English, and regional languages. Use only the canonical short language name in the language field, such as Hindi, Punjabi, Urdu, or English—do not append script or transliteration notes. Never call Punjabi or Urdu Hindi just because they share vocabulary. For each line, set targetLanguageFit to target only when it is genuinely ${targetLanguage || 'Hindi'}, mixed when the line itself code-switches between the target and another language, other when it is another language, and unclear when there is not enough evidence. Translate each supplied line into concise natural English. Label its real-world register. Explain idioms, grammar, cultural context, language differences, or song-specific compression in one short sentence. For every meaningful surface word, add one wordGlosses entry using that exact word without surrounding punctuation and a short contextual English meaning; omit pure punctuation, vocalizations, and repeated duplicate words. For non-target lines, explicitly say that the learner should not treat the phrase as ${targetLanguage || 'Hindi'}. If a line is poetic, uncommon, overly formal, gendered in a relevant way, or unnatural in daily speech, give a genuinely common daily alternative in the original language with an English gloss. If it is already natural daily speech, dailyAlternative must be an empty string. Never invent certainty. Preserve every input index exactly once and do not quote unrelated lyrics.`,
          input: JSON.stringify({ track: { title: track.title, artist: track.artist }, lines: compactLines }),
          text: {
            format: {
              type: 'json_schema',
              name: 'song_language_coach',
              strict: true,
              schema: analysisSchema,
            },
          },
          max_output_tokens: 6000,
        }),
        signal: AbortSignal.timeout(90000),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || `OpenAI returned ${response.status}.`);
      const outputText = extractOutputText(body);
      if (!outputText) throw new Error('The language coach returned no analysis.');
      return JSON.parse(outputText);
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

module.exports = { createCoach, analysisSchema, extractOutputText, planAnalysis };
