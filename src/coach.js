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
        required: ['index', 'translation', 'register', 'explanation', 'dailyAlternative'],
        properties: {
          index: { type: 'integer' },
          translation: { type: 'string' },
          register: { type: 'string', enum: ['common', 'casual', 'formal', 'poetic', 'uncommon', 'unclear'] },
          explanation: { type: 'string' },
          dailyAlternative: { type: 'string' },
        },
      },
    },
  },
};

function createCoach({ apiKey, model, targetLanguage }) {
  return {
    async analyze({ track, lines }) {
      const compactLines = lines.slice(0, 160).map(({ index, text }) => ({ index, text }));
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model || 'gpt-5-mini',
          store: false,
          instructions: `You are a careful language teacher for an adult learner whose target is ${targetLanguage || 'Hindi'} and whose goal is natural daily conversation, not imitation of song lyrics. First identify the actual language of the supplied lyrics; songs may be in a related but different language such as Punjabi or Urdu, and you must say so accurately rather than treating every song as the target language. Translate each supplied line into concise natural English. Label its real-world register. Explain idioms, grammar, cultural context, language differences, or song-specific compression in one short sentence. If the line is poetic, uncommon, overly formal, gendered in a relevant way, or unnatural in daily speech, give a genuinely common daily alternative in the original language with an English gloss. If it is already natural daily speech, dailyAlternative must be an empty string. Never invent certainty: use unclear when context is insufficient. Preserve every input index exactly once and do not quote unrelated lyrics.`,
          input: JSON.stringify({ track: { title: track.title, artist: track.artist }, lines: compactLines }),
          text: {
            format: {
              type: 'json_schema',
              name: 'song_language_coach',
              strict: true,
              schema: analysisSchema,
            },
          },
        }),
        signal: AbortSignal.timeout(90000),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || `OpenAI returned ${response.status}.`);
      const outputText = extractOutputText(body);
      if (!outputText) throw new Error('The language coach returned no analysis.');
      return JSON.parse(outputText);
    },
  };
}

function extractOutputText(response) {
  if (typeof response?.output_text === 'string') return response.output_text;
  return (response?.output || [])
    .flatMap((item) => item?.content || [])
    .filter((content) => content?.type === 'output_text' && typeof content.text === 'string')
    .map((content) => content.text)
    .join('');
}

module.exports = { createCoach, analysisSchema, extractOutputText };
