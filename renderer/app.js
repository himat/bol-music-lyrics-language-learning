const demoTrack = {
  available: true, demo: true, isPlaying: true, state: 'playing', title: 'Aaj Ka Safar',
  artist: 'Bol demo · spot the Punjabi line', album: 'Your first conversation', durationMs: 25000,
  positionMs: 0, observedAt: Date.now(), artworkUrl: '', spotifyUrl: '',
};

const demoLyrics = {
  synced: true,
  lines: [
    { index: 0, timeMs: 0, text: 'आज मौसम अच्छा है' },
    { index: 1, timeMs: 5000, text: 'चलो, चाय पीते हैं' },
    { index: 2, timeMs: 10000, text: 'तुम्हारा दिन कैसा था?' },
    { index: 3, timeMs: 15000, text: 'बस, ठीक था—थोड़ा लंबा' },
    { index: 4, timeMs: 20000, text: 'ਕੱਲ੍ਹ ਫਿਰ ਮਿਲਾਂਗੇ' },
  ],
};

const demoAnalysis = {
  language: 'Hindi and Punjabi', summary: 'Most lines are natural Hindi; the final line is Punjabi and is marked so you do not learn it as Hindi.',
  lines: [
    { index: 0, translation: 'The weather is nice today.', language: 'Hindi', targetLanguageFit: 'target', register: 'common', explanation: 'A straightforward, everyday observation.', dailyAlternative: '', wordGlosses: [{ word: 'आज', meaning: 'today' }, { word: 'मौसम', meaning: 'weather' }, { word: 'अच्छा', meaning: 'nice / good' }, { word: 'है', meaning: 'is' }] },
    { index: 1, translation: 'Come on, let’s have tea.', language: 'Hindi', targetLanguageFit: 'target', register: 'casual', explanation: 'चलो is a very common way to suggest doing something together.', dailyAlternative: '', wordGlosses: [{ word: 'चलो', meaning: 'come on / let’s' }, { word: 'चाय', meaning: 'tea' }, { word: 'पीते', meaning: 'drink' }, { word: 'हैं', meaning: 'we do / are' }] },
    { index: 2, translation: 'How was your day?', language: 'Hindi', targetLanguageFit: 'target', register: 'common', explanation: 'Natural with friends, family, and colleagues.', dailyAlternative: '', wordGlosses: [{ word: 'तुम्हारा', meaning: 'your' }, { word: 'दिन', meaning: 'day' }, { word: 'कैसा', meaning: 'how / what kind' }, { word: 'था', meaning: 'was' }] },
    { index: 3, translation: 'It was fine—just a bit long.', language: 'Hindi', targetLanguageFit: 'target', register: 'casual', explanation: 'बस softens the answer and can mean “just” or “well.”', dailyAlternative: '', wordGlosses: [{ word: 'बस', meaning: 'just / well' }, { word: 'ठीक', meaning: 'fine / okay' }, { word: 'था', meaning: 'was' }, { word: 'थोड़ा', meaning: 'a little' }, { word: 'लंबा', meaning: 'long' }] },
    { index: 4, translation: 'We’ll meet again tomorrow.', language: 'Punjabi', targetLanguageFit: 'other', register: 'common', explanation: 'This is natural Punjabi, not Hindi, so do not count it as a Hindi phrase.', dailyAlternative: '', wordGlosses: [{ word: 'ਕੱਲ੍ਹ', meaning: 'tomorrow' }, { word: 'ਫਿਰ', meaning: 'again' }, { word: 'ਮਿਲਾਂਗੇ', meaning: 'we will meet' }] },
  ],
};

const elements = Object.fromEntries([
  'sourcePill','sourceLabel','languageLabel','trackTitle','trackArtist','coverArt','playingBars','elapsedTime',
  'trackLanguages','languageDetectionStatus','syncStatus','durationTime','progressFill','spotifyButton','lyricsScroll','emptyState','emptyTitle','emptyMessage','coachBody',
  'currentLineDock','translationStatus','analyzeButton','toast','settingsDialog','settingsForm','settingsButton','targetLanguageInput','apiKeyInput',
  'modelInput','apiKeyHelp','demoButton','homeButton','previousButton','playPauseButton','nextButton',
].map((id) => [id, document.getElementById(id)]));

const state = {
  track: demoTrack, lyrics: demoLyrics, analysis: demoAnalysis, activeIndex: -1, hoveredIndex: null,
  mode: 'demo', settings: { targetLanguage: 'Hindi', model: 'gpt-4o-mini', apiKey: '' },
  lastRealTrackKey: '', positionBase: 0, positionObservedAt: Date.now(), toastTimer: null,
  loadToken: 0, userBrowsing: false, programmaticScroll: false, browseTimer: null,
  isAnalyzing: false, analysisStartedAt: 0, analysisTimer: null, spotifyPollInFlight: false,
};

function trackKey(track) { return `${track.title}::${track.artist}::${track.durationMs}`; }
function formatTime(ms) { const seconds = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
function estimatedPosition() {
  const drift = state.track.isPlaying ? Date.now() - state.positionObservedAt : 0;
  return Math.min(state.track.durationMs || Infinity, state.positionBase + drift);
}

function showToast(message, duration = 3200) {
  elements.toast.textContent = message;
  elements.toast.classList.add('visible');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => elements.toast.classList.remove('visible'), duration);
}

function updateAnalysisElapsed() {
  if (!state.analysisStartedAt) return;
  const elapsed = Math.max(0, Math.floor((Date.now() - state.analysisStartedAt) / 1000));
  for (const element of document.querySelectorAll('.loading-elapsed')) element.textContent = `${elapsed}s elapsed`;
}

function startAnalysisTimer() {
  clearInterval(state.analysisTimer);
  state.analysisStartedAt = Date.now();
  updateAnalysisElapsed();
  state.analysisTimer = setInterval(updateAnalysisElapsed, 1000);
}

function stopAnalysisTimer() {
  clearInterval(state.analysisTimer);
  state.analysisTimer = null;
  state.analysisStartedAt = 0;
}

function setSource(label, connected) {
  elements.sourceLabel.textContent = label;
  elements.sourcePill.classList.toggle('connected', connected);
}

function renderTrack() {
  const track = state.track;
  elements.trackTitle.textContent = track.title;
  elements.trackArtist.textContent = track.artist + (track.album && !track.demo ? ` · ${track.album}` : '');
  elements.durationTime.textContent = formatTime(track.durationMs);
  elements.playingBars.classList.toggle('paused', !track.isPlaying);
  elements.playPauseButton.innerHTML = track.isPlaying
    ? '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7V5z"/></svg>';
  elements.playPauseButton.setAttribute('aria-label', track.isPlaying ? 'Pause' : 'Play');
  for (const button of [elements.previousButton, elements.playPauseButton, elements.nextButton]) button.disabled = Boolean(track.demo);
  elements.spotifyButton.hidden = !track.spotifyUrl;
  elements.coverArt.classList.toggle('demo-cover', !track.artworkUrl);
  elements.coverArt.style.backgroundImage = track.artworkUrl ? `url("${track.artworkUrl.replaceAll('"', '%22')}")` : '';
  elements.coverArt.innerHTML = track.artworkUrl ? '' : '<span>बोल</span>';
  renderTrackLanguages();
}

function renderTrackLanguages() {
  const analyzed = state.analysis?.lines || [];
  const counts = new Map();
  for (const line of analyzed) {
    const language = String(line.language || '').trim();
    if (!language) continue;
    const key = language.toLocaleLowerCase();
    const existing = counts.get(key) || { language, count: 0, fit: line.targetLanguageFit || 'unclear' };
    existing.count += 1;
    if (line.targetLanguageFit === 'target') existing.fit = 'target';
    else if (line.targetLanguageFit === 'mixed' && existing.fit !== 'target') existing.fit = 'mixed';
    counts.set(key, existing);
  }
  const languages = [...counts.values()].sort((a, b) => b.count - a.count);
  elements.trackLanguages.innerHTML = '';
  elements.trackLanguages.hidden = languages.length === 0;
  if (languages.length > 0) elements.languageDetectionStatus.hidden = true;
  for (const item of languages) {
    const pill = document.createElement('span');
    pill.className = `track-language-pill ${item.fit}`;
    const percentage = languages.length > 1 ? ` <em>${Math.round(item.count / analyzed.length * 100)}%</em>` : '';
    pill.innerHTML = `${escapeHTML(item.language)}${percentage}`;
    elements.trackLanguages.appendChild(pill);
  }
}

function analysisFor(index) { return state.analysis?.lines?.find((line) => line.index === index); }

function languageLabel(analysis) {
  if (!analysis || analysis.targetLanguageFit === 'target') return '';
  return analysis.language || 'Language unclear';
}

function learningVerdict(analysis) {
  const naturalDailySpeech = analysis.targetLanguageFit === 'target'
    && ['common', 'casual'].includes(analysis.register)
    && !analysis.dailyAlternative;
  if (naturalDailySpeech) {
    return { className: 'learn', title: 'Learn as is', detail: 'Natural for daily speech' };
  }
  const detail = analysis.targetLanguageFit !== 'target'
    ? `${analysis.language || 'Another language'} · not your target language`
    : analysis.dailyAlternative
      ? 'Use the daily alternative below'
      : 'Not natural for everyday conversation';
  return { className: 'adapt', title: 'Don’t learn as is', detail };
}

function normalizedWord(value) {
  return String(value || '').normalize('NFKC').replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '').toLocaleLowerCase();
}

function appendGlossedWords(container, text, analysis) {
  const meanings = new Map((analysis?.wordGlosses || []).map(({ word, meaning }) => [normalizedWord(word), meaning]));
  const segments = new Intl.Segmenter(undefined, { granularity: 'word' }).segment(String(text));
  for (const { segment, isWordLike } of segments) {
    const meaning = isWordLike ? meanings.get(normalizedWord(segment)) : '';
    if (!meaning) {
      container.appendChild(document.createTextNode(segment));
      continue;
    }
    const word = document.createElement('span');
    word.className = 'lyric-word';
    word.textContent = segment;
    word.dataset.meaning = meaning;
    word.setAttribute('aria-label', `${segment}: ${meaning}`);
    container.appendChild(word);
  }
}

function glossedWordsHTML(text, analysis) {
  const holder = document.createElement('span');
  appendGlossedWords(holder, text, analysis);
  return holder.innerHTML;
}

function renderLyrics() {
  elements.emptyState.hidden = true;
  elements.lyricsScroll.hidden = false;
  elements.lyricsScroll.innerHTML = '';
  elements.syncStatus.hidden = false;
  elements.syncStatus.textContent = state.track.demo
    ? 'Demo timing'
    : state.lyrics.synced ? 'Synced lyrics' : 'Plain lyrics · no timing';
  elements.syncStatus.classList.toggle('unsynced', !state.lyrics.synced);
  elements.syncStatus.classList.toggle('demo', Boolean(state.track.demo));
  for (const line of state.lyrics.lines) {
    const analysis = analysisFor(line.index);
    const row = document.createElement('div');
    row.className = 'lyric-row';
    if (analysis?.targetLanguageFit) row.classList.add(`language-${analysis.targetLanguageFit}`);
    row.dataset.index = line.index;
    const original = document.createElement('div');
    original.className = 'lyric-original';
    const originalText = document.createElement('span');
    appendGlossedWords(originalText, line.text, analysis);
    original.appendChild(originalText);
    const label = languageLabel(analysis);
    if (label) {
      const languageTag = document.createElement('small');
      languageTag.className = `language-tag ${analysis.targetLanguageFit}`;
      languageTag.textContent = label;
      original.appendChild(languageTag);
    }
    const translation = document.createElement('div');
    translation.className = 'lyric-translation';
    if (analysis) translation.textContent = analysis.translation;
    else translation.innerHTML = '<span class="translation-placeholder"></span>';
    row.append(original, translation);
    row.addEventListener('mouseenter', () => selectCoachLine(line.index, true));
    row.addEventListener('mouseleave', () => { state.hoveredIndex = null; updateRows(); selectCoachLine(state.activeIndex, false); });
    elements.lyricsScroll.appendChild(row);
  }
  updateRows();
  renderCurrentLineDock();
  if (!state.analysis) {
    elements.coachBody.innerHTML = '<div class="coach-intro"><p>Add an API key, then analyze the song to get English translations and daily-speech guidance.</p></div>';
  }
}

function renderCurrentLineDock() {
  const line = state.lyrics?.lines?.find((item) => item.index === state.activeIndex);
  if (!line) {
    elements.currentLineDock.hidden = true;
    elements.currentLineDock.innerHTML = '';
    return;
  }
  const analysis = analysisFor(line.index);
  const label = languageLabel(analysis);
  const languageTag = label ? `<small class="language-tag ${analysis.targetLanguageFit}">${escapeHTML(label)}</small>` : '';
  const translation = analysis?.translation
    ? escapeHTML(analysis.translation)
    : '<span class="translation-placeholder"></span>';
  elements.currentLineDock.innerHTML = `<span class="dock-original"><span class="dock-live">Live</span><span class="dock-copy"><span>${glossedWordsHTML(line.text, analysis)}</span>${languageTag}</span></span><span class="dock-translation">${translation}</span>`;
  elements.currentLineDock.hidden = false;
}

function scrollToActive() {
  const row = elements.lyricsScroll.querySelector(`[data-index="${state.activeIndex}"]`);
  if (!row) return;
  state.userBrowsing = false;
  state.programmaticScroll = true;
  row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  setTimeout(() => { state.programmaticScroll = false; }, 650);
}

function updateRows() {
  for (const row of elements.lyricsScroll.querySelectorAll('.lyric-row')) {
    const index = Number(row.dataset.index);
    row.classList.toggle('active', index === state.activeIndex);
    row.classList.toggle('hovered', index === state.hoveredIndex);
  }
}

function selectCoachLine(index, hovered = false) {
  if (hovered) state.hoveredIndex = index;
  updateRows();
  const line = state.lyrics.lines.find((item) => item.index === index);
  const analysis = analysisFor(index);
  if (!line || !analysis) {
    if (state.isAnalyzing) {
      elements.coachBody.innerHTML = `<div class="analysis-loading line-loading">
        <span class="analysis-spinner"></span>
        <strong>Translating this line</strong>
        ${line ? `<p class="loading-source">${escapeHTML(line.text)}</p>` : ''}
        <span class="loading-detail">Meaning and usage are on the way</span>
        <span class="loading-elapsed"></span>
      </div>`;
      updateAnalysisElapsed();
    } else {
      elements.coachBody.innerHTML = `<div class="coach-intro"><p>${state.analysis ? 'This line has no analysis yet.' : 'Add an API key, then analyze the song to see daily-speech guidance.'}</p></div>`;
    }
    return;
  }
  const alternative = analysis.dailyAlternative
    ? `<div class="alternative"><small>SAY THIS IN DAILY LIFE</small><p>${escapeHTML(analysis.dailyAlternative)}</p></div>` : '';
  const languageWarning = languageLabel(analysis);
  const languageBadge = languageWarning
    ? `<span class="coach-language-badge ${analysis.targetLanguageFit}">${escapeHTML(languageWarning)}</span>` : '';
  const verdict = learningVerdict(analysis);
  elements.coachBody.innerHTML = `<div class="coach-card">
    <div class="learning-verdict ${verdict.className}"><span class="verdict-icon">${verdict.className === 'learn' ? '✓' : '!'}</span><span><strong>${verdict.title}</strong><small>${escapeHTML(verdict.detail)}</small></span></div>
    <div class="coach-badges"><span class="register-badge ${analysis.register}">${escapeHTML(analysis.register)}</span>${languageBadge}</div>
    <p class="coach-quote">${escapeHTML(line.text)}</p>
    <p class="coach-translation">“${escapeHTML(analysis.translation)}”</p>
    <div class="explanation-block"><small>WHY IT MATTERS</small><p>${escapeHTML(analysis.explanation)}</p></div>
    ${alternative}
  </div>`;
}

function escapeHTML(value = '') { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }

function setEmpty(title, message) {
  elements.lyricsScroll.hidden = true;
  elements.emptyState.hidden = false;
  elements.emptyTitle.textContent = title;
  elements.emptyMessage.textContent = message;
  elements.coachBody.innerHTML = '<div class="coach-intro"><p>Play a song to begin learning.</p></div>';
  elements.currentLineDock.hidden = true;
  elements.syncStatus.hidden = true;
}

async function loadTrack(track) {
  const token = ++state.loadToken;
  state.track = track;
  state.positionBase = track.positionMs;
  state.positionObservedAt = track.observedAt || Date.now();
  state.lyrics = { synced: false, lines: [] };
  state.analysis = null;
  state.isAnalyzing = false;
  stopAnalysisTimer();
  elements.translationStatus.hidden = true;
  elements.syncStatus.hidden = true;
  elements.languageDetectionStatus.hidden = true;
  state.activeIndex = -1;
  renderTrack();
  setEmpty('Finding synchronized lyrics…', `${track.title} · ${track.artist}`);
  try {
    const lyrics = await window.bol.fetchLyrics(track);
    if (token !== state.loadToken) return;
    state.lyrics = lyrics;
    if (!state.lyrics.lines.length) throw new Error('This track is instrumental.');
    renderLyrics();
    elements.analyzeButton.hidden = false;
    await analyzeCurrentSong(true);
  } catch (error) {
    if (token !== state.loadToken) return;
    setEmpty('Lyrics weren’t found', error.message || 'Try another song.');
    elements.analyzeButton.hidden = true;
  }
}

async function analyzeCurrentSong(automatic = false) {
  if (!state.lyrics?.lines?.length || state.analysis) return;
  elements.analyzeButton.hidden = false;
  elements.analyzeButton.disabled = true;
  state.isAnalyzing = true;
  startAnalysisTimer();
  elements.languageDetectionStatus.hidden = false;
  elements.languageDetectionStatus.classList.remove('unavailable');
  elements.languageDetectionStatus.textContent = 'Detecting languages…';
  elements.analyzeButton.innerHTML = '<span>✦</span> Reading the language…';
  elements.translationStatus.hidden = false;
  elements.coachBody.innerHTML = `<div class="analysis-loading">
    <span class="analysis-spinner"></span>
    <strong>Translating this song</strong>
    <p>Checking each lyric for its English meaning, language, and whether people actually say it.</p>
    <span class="loading-detail">Usually takes a few seconds</span>
    <span class="loading-elapsed">0s elapsed</span>
  </div>`;
  try {
    state.analysis = await window.bol.analyze({ track: state.track, lines: state.lyrics.lines });
    state.isAnalyzing = false;
    stopAnalysisTimer();
    renderTrackLanguages();
    renderLyrics();
    renderCurrentLineDock();
    selectCoachLine(Math.max(0, state.activeIndex), false);
    elements.analyzeButton.hidden = true;
    elements.translationStatus.hidden = true;
  } catch (error) {
    state.isAnalyzing = false;
    stopAnalysisTimer();
    elements.languageDetectionStatus.hidden = false;
    elements.languageDetectionStatus.classList.add('unavailable');
    elements.languageDetectionStatus.textContent = 'Language not analyzed';
    elements.analyzeButton.disabled = false;
    elements.analyzeButton.innerHTML = '<span>✦</span> Analyze this song';
    elements.translationStatus.hidden = true;
    const message = String(error.message || 'Translation failed. Please try again.').replace(/^Error invoking remote method '[^']+': Error:\s*/, '');
    elements.coachBody.innerHTML = `<div class="coach-intro"><p>${escapeHTML(message)}</p></div>`;
    if (!automatic || !/API key/i.test(message)) showToast(message, 6000);
  }
}

function useDemo() {
  state.loadToken += 1;
  state.lastRealTrackKey = '';
  state.mode = 'demo';
  state.track = { ...demoTrack, positionMs: 0, observedAt: Date.now() };
  state.lyrics = demoLyrics;
  state.analysis = demoAnalysis;
  state.isAnalyzing = false;
  stopAnalysisTimer();
  elements.languageDetectionStatus.hidden = true;
  elements.translationStatus.hidden = true;
  state.positionBase = 0;
  state.positionObservedAt = Date.now();
  state.activeIndex = -1;
  setSource('Demo · Spotify is not playing', false);
  renderTrack();
  renderLyrics();
  elements.analyzeButton.hidden = true;
  selectCoachLine(0, false);
}

async function pollSpotify() {
  if (state.spotifyPollInFlight) return;
  state.spotifyPollInFlight = true;
  try {
    const spotify = await window.bol.spotifyState();
    if (!spotify.available) {
      setSource(state.mode === 'demo' ? 'Demo · Spotify is not playing' : spotify.reason, false);
      return;
    }
    setSource(spotify.isPlaying ? 'Listening to Spotify' : 'Spotify paused', true);
    const key = trackKey(spotify);
    state.mode = 'spotify';
    state.positionBase = spotify.positionMs;
    state.positionObservedAt = spotify.observedAt;
    state.track.isPlaying = spotify.isPlaying;
    state.track.positionMs = spotify.positionMs;
    elements.playingBars.classList.toggle('paused', !spotify.isPlaying);
    if (key !== state.lastRealTrackKey) {
      state.lastRealTrackKey = key;
      loadTrack(spotify);
    }
  } catch (error) {
    setSource('Spotify connection unavailable', false);
  } finally {
    state.spotifyPollInFlight = false;
  }
}

async function controlPlayback(action) {
  if (state.mode !== 'spotify') return;
  try {
    if (action === 'playPause') {
      const currentPosition = estimatedPosition();
      state.track.isPlaying = !state.track.isPlaying;
      state.positionBase = currentPosition;
      state.positionObservedAt = Date.now();
      renderTrack();
    }
    await window.bol.spotifyControl(action);
    setTimeout(pollSpotify, 250);
  } catch (error) {
    showToast(String(error.message || 'Spotify control failed.').replace(/^Error invoking remote method '[^']+': Error:\s*/, ''));
    await pollSpotify();
  }
}

function tick() {
  const position = estimatedPosition();
  elements.elapsedTime.textContent = formatTime(position);
  const progress = state.track.durationMs ? Math.min(100, position / state.track.durationMs * 100) : 0;
  elements.progressFill.style.width = `${progress}%`;
  if (!state.lyrics?.synced) return;
  let next = -1;
  for (const line of state.lyrics.lines) {
    if (line.timeMs > position) break;
    next = line.index;
  }
  if (next !== state.activeIndex) {
    state.activeIndex = next;
    updateRows();
    renderCurrentLineDock();
    const row = elements.lyricsScroll.querySelector(`[data-index="${next}"]`);
    if (row && state.hoveredIndex === null && !state.userBrowsing) {
      state.programmaticScroll = true;
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(() => { state.programmaticScroll = false; }, 650);
      selectCoachLine(next, false);
    }
  }
  if (state.mode === 'demo' && position >= state.track.durationMs) {
    state.positionBase = 0; state.positionObservedAt = Date.now();
  }
}

async function openSettings() {
  state.settings = await window.bol.loadSettings();
  elements.targetLanguageInput.value = state.settings.targetLanguage || 'Hindi';
  elements.modelInput.value = state.settings.model || 'gpt-4o-mini';
  elements.apiKeyInput.value = '';
  elements.apiKeyInput.placeholder = state.settings.apiKey ? 'Saved securely · enter to replace' : 'sk-…';
  elements.settingsDialog.showModal();
}

elements.settingsButton.addEventListener('click', openSettings);
elements.demoButton.addEventListener('click', useDemo);
elements.homeButton.addEventListener('click', useDemo);
elements.spotifyButton.addEventListener('click', () => state.track.spotifyUrl && window.bol.openExternal(state.track.spotifyUrl));
elements.apiKeyHelp.addEventListener('click', () => window.bol.openExternal('https://platform.openai.com/api-keys'));
elements.analyzeButton.addEventListener('click', () => analyzeCurrentSong(false));
elements.previousButton.addEventListener('click', () => controlPlayback('previous'));
elements.playPauseButton.addEventListener('click', () => controlPlayback('playPause'));
elements.nextButton.addEventListener('click', () => controlPlayback('next'));
elements.currentLineDock.addEventListener('click', scrollToActive);
elements.lyricsScroll.addEventListener('scroll', () => {
  if (state.programmaticScroll) return;
  state.userBrowsing = true;
  clearTimeout(state.browseTimer);
  state.browseTimer = setTimeout(() => { state.userBrowsing = false; }, 12000);
}, { passive: true });
document.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || event.repeat || state.mode !== 'spotify') return;
  const target = event.target;
  const isInteractive = target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLButtonElement
    || target?.isContentEditable
    || elements.settingsDialog.open;
  if (isInteractive) return;
  event.preventDefault();
  controlPlayback('playPause');
});
elements.settingsForm.addEventListener('submit', async (event) => {
  if (event.submitter?.value !== 'default') return;
  event.preventDefault();
  const next = {
    targetLanguage: elements.targetLanguageInput.value.trim() || 'Hindi',
    model: elements.modelInput.value.trim() || 'gpt-4o-mini',
    apiKey: elements.apiKeyInput.value.trim() || state.settings.apiKey,
  };
  await window.bol.saveSettings(next);
  state.settings = next;
  elements.languageLabel.textContent = `Learning ${next.targetLanguage}`;
  elements.settingsDialog.close();
  showToast('Settings saved');
  if (state.mode === 'spotify' && !state.analysis) analyzeCurrentSong(true);
});

async function init() {
  state.settings = await window.bol.loadSettings();
  elements.languageLabel.textContent = `Learning ${state.settings.targetLanguage || 'Hindi'}`;
  useDemo();
  await pollSpotify();
  setInterval(pollSpotify, 2000);
  setInterval(tick, 200);
}

init();
