const demoTrack = {
  available: true, demo: true, isPlaying: true, state: 'playing', title: 'Aaj Ka Safar',
  artist: 'Bol demo · everyday Hindi', album: 'Your first conversation', durationMs: 25000,
  positionMs: 0, observedAt: Date.now(), artworkUrl: '', spotifyUrl: '',
};

const demoLyrics = {
  synced: true,
  lines: [
    { index: 0, timeMs: 0, text: 'आज मौसम अच्छा है' },
    { index: 1, timeMs: 5000, text: 'चलो, चाय पीते हैं' },
    { index: 2, timeMs: 10000, text: 'तुम्हारा दिन कैसा था?' },
    { index: 3, timeMs: 15000, text: 'बस, ठीक था—थोड़ा लंबा' },
    { index: 4, timeMs: 20000, text: 'कल फिर मिलते हैं' },
  ],
};

const demoAnalysis = {
  language: 'Hindi', summary: 'These are all natural phrases you can use in relaxed daily conversation.',
  lines: [
    { index: 0, translation: 'The weather is nice today.', register: 'common', explanation: 'A straightforward, everyday observation.', dailyAlternative: '' },
    { index: 1, translation: 'Come on, let’s have tea.', register: 'casual', explanation: 'चलो is a very common way to suggest doing something together.', dailyAlternative: '' },
    { index: 2, translation: 'How was your day?', register: 'common', explanation: 'Natural with friends, family, and colleagues.', dailyAlternative: '' },
    { index: 3, translation: 'It was fine—just a bit long.', register: 'casual', explanation: 'बस softens the answer and can mean “just” or “well.”', dailyAlternative: '' },
    { index: 4, translation: 'Let’s meet again tomorrow.', register: 'common', explanation: 'A natural, friendly way to make a casual plan.', dailyAlternative: '' },
  ],
};

const elements = Object.fromEntries([
  'sourcePill','sourceLabel','languageLabel','trackTitle','trackArtist','coverArt','playingBars','elapsedTime',
  'durationTime','progressFill','spotifyButton','lyricsScroll','emptyState','emptyTitle','emptyMessage','coachBody',
  'analyzeButton','toast','settingsDialog','settingsForm','settingsButton','targetLanguageInput','apiKeyInput',
  'modelInput','apiKeyHelp','demoButton','homeButton',
].map((id) => [id, document.getElementById(id)]));

const state = {
  track: demoTrack, lyrics: demoLyrics, analysis: demoAnalysis, activeIndex: -1, hoveredIndex: null,
  mode: 'demo', settings: { targetLanguage: 'Hindi', model: 'gpt-4o-mini', apiKey: '' },
  lastRealTrackKey: '', positionBase: 0, positionObservedAt: Date.now(), toastTimer: null,
  loadToken: 0, demoPinnedUntil: 0,
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
  elements.spotifyButton.hidden = !track.spotifyUrl;
  elements.coverArt.classList.toggle('demo-cover', !track.artworkUrl);
  elements.coverArt.style.backgroundImage = track.artworkUrl ? `url("${track.artworkUrl.replaceAll('"', '%22')}")` : '';
  elements.coverArt.innerHTML = track.artworkUrl ? '' : '<span>बोल</span>';
}

function analysisFor(index) { return state.analysis?.lines?.find((line) => line.index === index); }

function renderLyrics() {
  elements.emptyState.hidden = true;
  elements.lyricsScroll.hidden = false;
  elements.lyricsScroll.innerHTML = '';
  for (const line of state.lyrics.lines) {
    const analysis = analysisFor(line.index);
    const row = document.createElement('div');
    row.className = 'lyric-row';
    row.dataset.index = line.index;
    const original = document.createElement('div');
    original.className = 'lyric-original';
    original.textContent = line.text;
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
  if (!state.analysis) {
    elements.coachBody.innerHTML = '<div class="coach-intro"><p>Add an API key, then analyze the song to get English translations and daily-speech guidance.</p></div>';
  }
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
    elements.coachBody.innerHTML = `<div class="coach-intro"><p>${state.analysis ? 'This line has no analysis yet.' : 'Add an API key, then analyze the song to see daily-speech guidance.'}</p></div>`;
    return;
  }
  const alternative = analysis.dailyAlternative
    ? `<div class="alternative"><small>SAY THIS IN DAILY LIFE</small><p>${escapeHTML(analysis.dailyAlternative)}</p></div>` : '';
  elements.coachBody.innerHTML = `<div class="coach-card">
    <span class="register-badge ${analysis.register}">${escapeHTML(analysis.register)}</span>
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
}

async function loadTrack(track) {
  const token = ++state.loadToken;
  state.track = track;
  state.positionBase = track.positionMs;
  state.positionObservedAt = track.observedAt || Date.now();
  state.analysis = null;
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
  elements.analyzeButton.innerHTML = '<span>✦</span> Reading the language…';
  try {
    state.analysis = await window.bol.analyze({ track: state.track, lines: state.lyrics.lines });
    renderLyrics();
    selectCoachLine(Math.max(0, state.activeIndex), false);
    elements.analyzeButton.hidden = true;
  } catch (error) {
    elements.analyzeButton.disabled = false;
    elements.analyzeButton.innerHTML = '<span>✦</span> Analyze this song';
    const message = String(error.message || 'Translation failed. Please try again.').replace(/^Error invoking remote method '[^']+': Error:\s*/, '');
    elements.coachBody.innerHTML = `<div class="coach-intro"><p>${escapeHTML(message)}</p></div>`;
    if (!automatic || !/API key/i.test(message)) showToast(message, 6000);
  }
}

function useDemo(pinForExploration = true) {
  state.loadToken += 1;
  state.demoPinnedUntil = pinForExploration ? Date.now() + 60000 : 0;
  if (pinForExploration) state.lastRealTrackKey = '';
  state.mode = 'demo';
  state.track = { ...demoTrack, positionMs: 0, observedAt: Date.now() };
  state.lyrics = demoLyrics;
  state.analysis = demoAnalysis;
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
  try {
    const spotify = await window.bol.spotifyState();
    if (!spotify.available) {
      if (state.mode !== 'demo') setEmpty('Waiting for Spotify', spotify.reason);
      setSource(state.mode === 'demo' ? 'Demo · Spotify is not playing' : spotify.reason, false);
      return;
    }
    if (state.mode === 'demo' && state.demoPinnedUntil > Date.now()) return;
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
      await loadTrack(spotify);
    }
  } catch (error) {
    setSource('Spotify connection unavailable', false);
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
    const row = elements.lyricsScroll.querySelector(`[data-index="${next}"]`);
    if (row && state.hoveredIndex === null) {
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
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
elements.demoButton.addEventListener('click', () => useDemo(true));
elements.homeButton.addEventListener('click', () => useDemo(true));
elements.spotifyButton.addEventListener('click', () => state.track.spotifyUrl && window.bol.openExternal(state.track.spotifyUrl));
elements.apiKeyHelp.addEventListener('click', () => window.bol.openExternal('https://platform.openai.com/api-keys'));
elements.analyzeButton.addEventListener('click', () => analyzeCurrentSong(false));
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
  useDemo(false);
  await pollSpotify();
  setInterval(pollSpotify, 2000);
  setInterval(tick, 200);
}

init();
