const elements = Object.fromEntries([
  'sourcePill','sourceLabel','languageLabel','trackTitle','trackArtist','coverArt','playingBars','elapsedTime',
  'trackLanguages','languageDetectionStatus','syncStatus','durationTime','progressFill','spotifyButton','lyricsScroll','emptyState','emptyTitle','emptyMessage','coachPanel','coachBody',
  'currentLineDock','translationStatus','analyzeButton','toast','settingsDialog','settingsForm','settingsButton','targetLanguageInput','apiKeyInput',
  'modelInput','apiKeyHelp','homeButton','previousButton','playPauseButton','nextButton','repeatButton',
  'flashcardsButton','flashcardCount','flashcardsDialog','flashcardsCloseButton','browseFlashcardsTab','studyFlashcardsTab',
  'flashcardsBrowseView','flashcardsStudyView','flashcardsList','flashcardDetail',
].map((id) => [id, document.getElementById(id)]));

const state = {
  track: { isPlaying: false, title: 'Waiting for Spotify', artist: 'Open Spotify to begin', album: '', durationMs: 0, positionMs: 0, observedAt: Date.now(), artworkUrl: '', spotifyUrl: '' },
  lyrics: { synced: false, lines: [] }, analysis: null, activeIndex: -1, hoveredIndex: null,
  mode: 'waiting', settings: { targetLanguage: 'Hindi', model: 'gpt-4o-mini', apiKey: '' },
  lastRealTrackKey: '', positionBase: 0, positionObservedAt: Date.now(), toastTimer: null,
  loadToken: 0, userBrowsing: false, programmaticScroll: false, browseTimer: null,
  isAnalyzing: false, analysisStartedAt: 0, analysisTimer: null, spotifyPollInFlight: false,
  repeatMode: 'off', repeatRestarting: false,
  flashcards: [], selectedFlashcardId: null, flashcardMode: 'browse', studyIndex: 0, studyRevealed: false,
  flashcardGenerationKeys: new Set(),
};
let spotifyPollTimer = null;
let tickTimer = null;
let coachHoverExitTimer = null;

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
  elements.trackArtist.textContent = track.artist + (track.album ? ` · ${track.album}` : '');
  elements.durationTime.textContent = formatTime(track.durationMs);
  elements.playingBars.classList.toggle('paused', !track.isPlaying);
  elements.playPauseButton.innerHTML = track.isPlaying
    ? '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7V5z"/></svg>';
  elements.playPauseButton.setAttribute('aria-label', track.isPlaying ? 'Pause' : 'Play');
  for (const button of [elements.previousButton, elements.playPauseButton, elements.nextButton, elements.repeatButton]) button.disabled = state.mode !== 'spotify';
  renderRepeatControl();
  elements.spotifyButton.hidden = !track.spotifyUrl;
  elements.coverArt.classList.toggle('fallback-cover', !track.artworkUrl);
  elements.coverArt.style.backgroundImage = track.artworkUrl ? `url("${track.artworkUrl.replaceAll('"', '%22')}")` : '';
  elements.coverArt.innerHTML = track.artworkUrl ? '' : '<span>बोल</span>';
  renderTrackLanguages();
}

function renderRepeatControl() {
  const labels = {
    off: 'Repeat off',
    context: 'Repeat playlist or album',
    track: 'Repeat this track',
  };
  const label = labels[state.repeatMode] || labels.off;
  elements.repeatButton.classList.toggle('active', state.repeatMode !== 'off');
  elements.repeatButton.classList.toggle('one', state.repeatMode === 'track');
  elements.repeatButton.setAttribute('aria-label', label);
  elements.repeatButton.title = `${label} · click for next mode`;
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

function appendGlossedWords(container, text, analysis, className = 'lyric-word') {
  const glosses = new Map((analysis?.wordGlosses || []).map((gloss) => [normalizedWord(gloss.word), gloss]));
  const segments = new Intl.Segmenter(undefined, { granularity: 'word' }).segment(String(text));
  for (const { segment, isWordLike } of segments) {
    const gloss = isWordLike ? glosses.get(normalizedWord(segment)) : null;
    if (!gloss) {
      container.appendChild(document.createTextNode(segment));
      continue;
    }
    const word = document.createElement('span');
    word.className = className;
    word.textContent = segment;
    const romanization = gloss.romanization || segment;
    word.dataset.gloss = `${romanization} · ${gloss.meaning}`;
    word.dataset.word = gloss.word || segment;
    word.dataset.romanization = romanization;
    word.dataset.meaning = gloss.meaning || '';
    word.setAttribute('aria-label', `${segment}: ${romanization}; ${gloss.meaning}`);
    container.appendChild(word);
  }
}

function glossedWordsHTML(text, analysis, className) {
  const holder = document.createElement('span');
  appendGlossedWords(holder, text, analysis, className);
  return holder.innerHTML;
}

function keepCoachGlossInBounds(word) {
  const panel = elements.coachBody.getBoundingClientRect();
  const anchor = word.getBoundingClientRect();
  const tooltipWidth = Math.min(210, Math.max(120, panel.width - 16));
  const preferredLeft = anchor.left + anchor.width / 2 - tooltipWidth / 2;
  const left = Math.min(Math.max(preferredLeft, panel.left + 8), panel.right - tooltipWidth - 8);
  word.style.setProperty('--coach-gloss-left', `${left - anchor.left}px`);
}

function isSavedWord(language, word) {
  return state.flashcards.some((card) => normalizedWord(card.language) === normalizedWord(language)
    && normalizedWord(card.word) === normalizedWord(word));
}

function flashcardPayload(word, context) {
  return {
    word: word.dataset.word || word.textContent,
    romanization: word.dataset.romanization || '',
    meaning: word.dataset.meaning || '',
    language: context.language || state.settings.targetLanguage || 'Unknown',
    context: {
      text: context.text || '',
      translation: context.translation || '',
      songTitle: state.track.title || '',
      artist: state.track.artist || '',
      album: state.track.album || '',
    },
  };
}

function updateFlashcardCount() {
  elements.flashcardCount.textContent = String(state.flashcards.length);
}

function markSavedCoachWords() {
  for (const word of elements.coachBody.querySelectorAll('.coach-word')) {
    const language = word.dataset.language || state.settings.targetLanguage;
    const saved = isSavedWord(language, word.dataset.word || word.textContent);
    word.classList.toggle('saved', saved);
    word.title = saved ? 'Saved to your words' : 'Click to save this word';
  }
}

async function saveCoachWord(word, context) {
  if (word.classList.contains('saving')) return;
  const payload = flashcardPayload(word, context);
  word.classList.add('saving');
  try {
    const saved = await window.bol.saveFlashcard(payload);
    state.flashcards = saved.cards;
    state.selectedFlashcardId = saved.card.id;
    updateFlashcardCount();
    markSavedCoachWords();
    renderFlashcards();
    showToast(saved.created ? `${saved.card.word} saved · adding daily examples…` : `${saved.card.word} · another song context saved`);
    const generationKey = `${normalizedWord(payload.language)}::${normalizedWord(payload.word)}`;
    if (!saved.card.examples.length && !state.flashcardGenerationKeys.has(generationKey)) {
      state.flashcardGenerationKeys.add(generationKey);
      window.bol.generateFlashcardExamples(payload).then((result) => {
        state.flashcards = result.cards;
        updateFlashcardCount();
        renderFlashcards();
        showToast(`Daily examples added for ${result.card.word}`);
      }).catch((error) => {
        renderFlashcards();
        showToast(String(error.message || 'Word saved, but examples could not be generated.').replace(/^Error invoking remote method '[^']+': Error:\s*/, ''), 5000);
      }).finally(() => state.flashcardGenerationKeys.delete(generationKey));
    }
  } catch (error) {
    showToast(String(error.message || 'Could not save this word.').replace(/^Error invoking remote method '[^']+': Error:\s*/, ''));
  } finally {
    word.classList.remove('saving');
  }
}

function attachCoachWordActions(container, context) {
  for (const word of container.querySelectorAll('.coach-word')) {
    word.dataset.language = context.language || state.settings.targetLanguage;
    word.setAttribute('role', 'button');
    word.tabIndex = 0;
    word.addEventListener('mouseenter', () => keepCoachGlossInBounds(word));
    word.addEventListener('click', (event) => {
      event.stopPropagation();
      saveCoachWord(word, context);
    });
    word.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      saveCoachWord(word, context);
    });
  }
  markSavedCoachWords();
}

function flashcardEmptyHTML() {
  return '<div class="flashcard-empty"><span>✦</span><h3>Save your first word</h3><p>Click any underlined word in the Daily Speech Coach. Bol will keep its meaning, song context, and everyday examples here.</p></div>';
}

function renderFlashcardDetail(card) {
  if (!card) {
    elements.flashcardDetail.innerHTML = flashcardEmptyHTML();
    return;
  }
  const contexts = (card.contexts || []).map((context) => `<div class="context-card"><p>${escapeHTML(context.text)}</p><em>${escapeHTML(context.translation)}</em><small>${escapeHTML([context.songTitle, context.artist].filter(Boolean).join(' · '))}</small></div>`).join('');
  const examples = (card.examples || []).map((example) => `<div class="example-card"><p>${escapeHTML(example.text)}</p><em class="example-romanization">${escapeHTML(example.romanization)}</em><em>${escapeHTML(example.translation)}</em></div>`).join('');
  elements.flashcardDetail.innerHTML = `<div class="flashcard-detail-header"><div><h3>${escapeHTML(card.nativeScript || card.word)}</h3><p class="flashcard-romanization">${escapeHTML(card.romanization)}</p><p class="flashcard-meaning">${escapeHTML(card.meaning)}</p></div><button class="delete-card-button" data-delete-card="${escapeHTML(card.id)}">Remove word</button></div>
    <div class="flashcard-section"><small>WHERE YOU HEARD IT</small>${contexts || '<div class="context-card"><p>No source phrase saved.</p></div>'}</div>
    <div class="flashcard-section"><small>EVERYDAY CONVERSATION</small>${examples || `<button class="retry-examples" data-retry-card="${escapeHTML(card.id)}">Generate daily examples</button>`}</div>`;
  elements.flashcardDetail.querySelector('[data-delete-card]')?.addEventListener('click', () => removeFlashcard(card.id));
  elements.flashcardDetail.querySelector('[data-retry-card]')?.addEventListener('click', (event) => retryFlashcardExamples(card, event.currentTarget));
}

function renderFlashcards() {
  updateFlashcardCount();
  if (!state.flashcards.length) {
    elements.flashcardsList.innerHTML = '';
    renderFlashcardDetail(null);
    renderStudyView();
    return;
  }
  if (!state.flashcards.some((card) => card.id === state.selectedFlashcardId)) state.selectedFlashcardId = state.flashcards[0].id;
  elements.flashcardsList.innerHTML = state.flashcards.map((card) => `<button class="flashcard-list-item ${card.id === state.selectedFlashcardId ? 'active' : ''}" data-card-id="${escapeHTML(card.id)}"><strong>${escapeHTML(card.nativeScript || card.word)}</strong><span>${escapeHTML(card.romanization)} · ${escapeHTML(card.meaning)}</span><small>${escapeHTML(card.language)}</small></button>`).join('');
  for (const button of elements.flashcardsList.querySelectorAll('[data-card-id]')) {
    button.addEventListener('click', () => {
      state.selectedFlashcardId = button.dataset.cardId;
      renderFlashcards();
    });
  }
  renderFlashcardDetail(state.flashcards.find((card) => card.id === state.selectedFlashcardId));
  renderStudyView();
}

async function removeFlashcard(id) {
  state.flashcards = await window.bol.deleteFlashcard(id);
  state.selectedFlashcardId = state.flashcards[0]?.id || null;
  state.studyIndex = Math.min(state.studyIndex, Math.max(0, state.flashcards.length - 1));
  renderFlashcards();
  markSavedCoachWords();
  showToast('Word removed');
}

async function retryFlashcardExamples(card, button) {
  button.disabled = true;
  button.textContent = 'Generating…';
  const payload = { ...card, context: card.contexts?.[0] || {} };
  try {
    const result = await window.bol.generateFlashcardExamples(payload);
    state.flashcards = result.cards;
    renderFlashcards();
    showToast(`Daily examples added for ${card.word}`);
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Try again';
    showToast(String(error.message || 'Could not generate examples.').replace(/^Error invoking remote method '[^']+': Error:\s*/, ''));
  }
}

function renderStudyView() {
  if (!state.flashcards.length) {
    elements.flashcardsStudyView.innerHTML = flashcardEmptyHTML();
    return;
  }
  state.studyIndex %= state.flashcards.length;
  const card = state.flashcards[state.studyIndex];
  const source = card.contexts?.[0];
  const answer = state.studyRevealed ? `<div class="study-answer"><strong>${escapeHTML(card.romanization)}</strong><p>${escapeHTML(card.meaning)}</p>${source ? `<div class="study-source">${escapeHTML(source.text)} · “${escapeHTML(source.translation)}”</div>` : ''}</div><div class="study-actions"><button class="again-answer" data-study-answer="again">Again</button><button class="remembered-answer" data-study-answer="remembered">Got it</button></div>` : '<div class="study-actions"><button class="reveal-answer" id="revealFlashcardAnswer">Show answer</button></div>';
  elements.flashcardsStudyView.innerHTML = `<div class="study-card"><span class="study-progress">${state.studyIndex + 1} of ${state.flashcards.length} · What does this mean?</span><h3>${escapeHTML(card.nativeScript || card.word)}</h3><span class="study-prompt">Say the meaning and pronunciation before revealing it</span>${answer}</div>`;
  elements.flashcardsStudyView.querySelector('#revealFlashcardAnswer')?.addEventListener('click', () => { state.studyRevealed = true; renderStudyView(); });
  for (const button of elements.flashcardsStudyView.querySelectorAll('[data-study-answer]')) {
    button.addEventListener('click', async () => {
      const remembered = button.dataset.studyAnswer === 'remembered';
      await window.bol.reviewFlashcard(card.id, remembered);
      state.studyIndex = (state.studyIndex + 1) % state.flashcards.length;
      state.studyRevealed = false;
      renderStudyView();
    });
  }
}

function setFlashcardMode(mode) {
  state.flashcardMode = mode;
  elements.browseFlashcardsTab.classList.toggle('active', mode === 'browse');
  elements.studyFlashcardsTab.classList.toggle('active', mode === 'study');
  elements.flashcardsBrowseView.hidden = mode !== 'browse';
  elements.flashcardsStudyView.hidden = mode !== 'study';
  if (mode === 'study') renderStudyView();
}

async function openFlashcards() {
  state.flashcards = await window.bol.listFlashcards();
  renderFlashcards();
  setFlashcardMode('browse');
  elements.flashcardsDialog.showModal();
}

function renderLyrics() {
  elements.emptyState.hidden = true;
  elements.lyricsScroll.hidden = false;
  elements.lyricsScroll.innerHTML = '';
  elements.syncStatus.hidden = false;
  elements.syncStatus.textContent = state.lyrics.synced ? 'Synced lyrics' : 'Plain lyrics · no timing';
  elements.syncStatus.classList.toggle('unsynced', !state.lyrics.synced);
  for (const line of state.lyrics.lines) {
    const analysis = analysisFor(line.index);
    const row = document.createElement('div');
    row.className = 'lyric-row';
    if (state.lyrics.synced) {
      row.classList.add('seekable');
      row.title = `Jump to ${formatTime(line.timeMs)}`;
    }
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
    row.addEventListener('mouseenter', () => {
      cancelCoachHoverExit();
      selectCoachLine(line.index, true);
    });
    row.addEventListener('mouseleave', scheduleCoachHoverExit);
    row.addEventListener('click', () => seekToLine(line));
    elements.lyricsScroll.appendChild(row);
  }
  updateRows();
  renderCurrentLineDock();
  if (!state.analysis) {
    elements.coachBody.innerHTML = '<div class="coach-intro"><p>Add an API key, then analyze the song to get English translations and daily-speech guidance.</p></div>';
  }
}

function cancelCoachHoverExit() {
  clearTimeout(coachHoverExitTimer);
  coachHoverExitTimer = null;
}

function scheduleCoachHoverExit() {
  cancelCoachHoverExit();
  coachHoverExitTimer = setTimeout(() => {
    if (elements.coachPanel.matches(':hover') || elements.lyricsScroll.matches(':hover')) return;
    state.hoveredIndex = null;
    updateRows();
    selectCoachLine(state.activeIndex, false);
  }, 1500);
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
    ? `<div class="alternative"><small>SAY THIS IN DAILY LIFE</small><p>${glossedWordsHTML(analysis.dailyAlternative, { wordGlosses: analysis.dailyAlternativeWordGlosses }, 'coach-word')}</p>${analysis.dailyAlternativeTranslation ? `<span class="alternative-translation">${escapeHTML(analysis.dailyAlternativeTranslation)}</span>` : ''}</div>` : '';
  const languageWarning = languageLabel(analysis);
  const languageBadge = languageWarning
    ? `<span class="coach-language-badge ${analysis.targetLanguageFit}">${escapeHTML(languageWarning)}</span>` : '';
  const verdict = learningVerdict(analysis);
  const quote = glossedWordsHTML(line.text, analysis, 'coach-word');
  elements.coachBody.innerHTML = `<div class="coach-card">
    <div class="learning-verdict ${verdict.className}"><span class="verdict-icon">${verdict.className === 'learn' ? '✓' : '!'}</span><span><strong>${verdict.title}</strong><small>${escapeHTML(verdict.detail)}</small></span></div>
    <div class="coach-badges"><span class="register-badge ${analysis.register}">${escapeHTML(analysis.register)}</span>${languageBadge}</div>
    <p class="coach-quote">${quote}</p>
    <p class="coach-translation">“${escapeHTML(analysis.translation)}”</p>
    <div class="explanation-block"><small>WHY IT MATTERS</small><p>${escapeHTML(analysis.explanation)}</p></div>
    ${alternative}
  </div>`;
  const quoteContainer = elements.coachBody.querySelector('.coach-quote');
  if (quoteContainer) attachCoachWordActions(quoteContainer, {
    text: line.text,
    translation: analysis.translation,
    language: analysis.language,
  });
  const alternativeContainer = elements.coachBody.querySelector('.alternative p');
  if (alternativeContainer) attachCoachWordActions(alternativeContainer, {
    text: analysis.dailyAlternative,
    translation: analysis.dailyAlternativeTranslation,
    language: state.settings.targetLanguage,
  });
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
  cancelCoachHoverExit();
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
  state.hoveredIndex = null;
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

async function pollSpotify() {
  if (state.spotifyPollInFlight) return;
  state.spotifyPollInFlight = true;
  try {
    const spotify = await window.bol.spotifyState();
    if (!spotify.available) {
      setSource(spotify.reason, false);
      if (state.mode === 'waiting') setEmpty('Waiting for Spotify', spotify.reason);
      return;
    }
    setSource(spotify.isPlaying ? 'Listening to Spotify' : 'Spotify paused', true);
    const key = trackKey(spotify);
    state.mode = 'spotify';
    state.positionBase = spotify.positionMs;
    state.positionObservedAt = spotify.observedAt;
    state.track.isPlaying = spotify.isPlaying;
    state.track.positionMs = spotify.positionMs;
    if (state.repeatMode !== 'track') state.repeatMode = spotify.repeatMode || 'off';
    elements.playingBars.classList.toggle('paused', !spotify.isPlaying);
    renderRepeatControl();
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

async function cycleRepeatMode() {
  if (state.mode !== 'spotify') return;
  const previous = state.repeatMode;
  const modes = { off: 'context', context: 'track', track: 'off' };
  state.repeatMode = modes[previous] || 'off';
  state.repeatRestarting = false;
  renderRepeatControl();
  try {
    await window.bol.spotifyControl(state.repeatMode === 'context' ? 'repeatContext' : 'repeatOff');
    const messages = {
      off: 'Repeat off',
      context: 'Repeating this playlist or album',
      track: 'Repeating this track while Bol is open',
    };
    showToast(messages[state.repeatMode]);
    scheduleSpotifyPoll(250);
  } catch (error) {
    state.repeatMode = previous;
    renderRepeatControl();
    showToast(String(error.message || 'Could not change repeat mode.').replace(/^Error invoking remote method '[^']+': Error:\s*/, ''));
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
    scheduleSpotifyPoll(250);
  } catch (error) {
    showToast(String(error.message || 'Spotify control failed.').replace(/^Error invoking remote method '[^']+': Error:\s*/, ''));
    await pollSpotify();
  }
}

async function seekToLine(line) {
  if (state.mode !== 'spotify' || !state.lyrics.synced || !Number.isFinite(line?.timeMs)) return;
  const positionMs = Math.max(0, line.timeMs);
  state.positionBase = positionMs;
  state.positionObservedAt = Date.now();
  state.track.positionMs = positionMs;
  state.track.isPlaying = true;
  state.activeIndex = line.index;
  state.userBrowsing = false;
  updateRows();
  renderCurrentLineDock();
  selectCoachLine(line.index, false);
  renderTrack();
  try {
    await window.bol.spotifySeek(positionMs, true);
    scheduleSpotifyPoll(250);
  } catch (error) {
    showToast(String(error.message || 'Could not jump to that lyric.').replace(/^Error invoking remote method '[^']+': Error:\s*/, ''));
    await pollSpotify();
  }
}

function tick() {
  const position = estimatedPosition();
  elements.elapsedTime.textContent = formatTime(position);
  const progress = state.track.durationMs ? Math.min(100, position / state.track.durationMs * 100) : 0;
  elements.progressFill.style.width = `${progress}%`;
  if (state.repeatMode === 'track'
    && state.track.isPlaying
    && state.track.durationMs > 0
    && state.track.durationMs - position <= 350
    && position > 1000
    && !state.repeatRestarting) {
    state.repeatRestarting = true;
    state.positionBase = 0;
    state.positionObservedAt = Date.now();
    state.track.positionMs = 0;
    window.bol.spotifySeek(0, true)
      .then(() => scheduleSpotifyPoll(250))
      .catch((error) => showToast(String(error.message || 'Could not repeat this track.').replace(/^Error invoking remote method '[^']+': Error:\s*/, '')))
      .finally(() => { state.repeatRestarting = false; });
  }
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
}

function scheduleSpotifyPoll(delay) {
  clearTimeout(spotifyPollTimer);
  const nextDelay = delay ?? (document.hidden ? 10000 : state.track.isPlaying ? 3000 : 5000);
  spotifyPollTimer = setTimeout(async () => {
    await pollSpotify();
    scheduleSpotifyPoll();
  }, nextDelay);
}

function scheduleTick(delay) {
  clearTimeout(tickTimer);
  const nextDelay = delay ?? (state.repeatMode === 'track' && state.track.isPlaying ? 200 : document.hidden ? 1000 : state.track.isPlaying ? 250 : 1000);
  tickTimer = setTimeout(() => {
    tick();
    scheduleTick();
  }, nextDelay);
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
elements.flashcardsButton.addEventListener('click', openFlashcards);
elements.flashcardsCloseButton.addEventListener('click', () => elements.flashcardsDialog.close());
elements.browseFlashcardsTab.addEventListener('click', () => setFlashcardMode('browse'));
elements.studyFlashcardsTab.addEventListener('click', () => setFlashcardMode('study'));
elements.homeButton.addEventListener('click', pollSpotify);
elements.spotifyButton.addEventListener('click', () => state.track.spotifyUrl && window.bol.openExternal(state.track.spotifyUrl));
elements.apiKeyHelp.addEventListener('click', () => window.bol.openExternal('https://platform.openai.com/api-keys'));
elements.analyzeButton.addEventListener('click', () => analyzeCurrentSong(false));
elements.previousButton.addEventListener('click', () => controlPlayback('previous'));
elements.playPauseButton.addEventListener('click', () => controlPlayback('playPause'));
elements.nextButton.addEventListener('click', () => controlPlayback('next'));
elements.repeatButton.addEventListener('click', cycleRepeatMode);
elements.currentLineDock.addEventListener('click', scrollToActive);
elements.lyricsScroll.addEventListener('mouseleave', scheduleCoachHoverExit);
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
    || elements.settingsDialog.open
    || elements.flashcardsDialog.open;
  if (isInteractive) return;
  event.preventDefault();
  controlPlayback('playPause');
});
document.addEventListener('visibilitychange', () => {
  scheduleSpotifyPoll(document.hidden ? 10000 : 0);
  scheduleTick(0);
});
elements.coachPanel.addEventListener('mouseenter', cancelCoachHoverExit);
elements.coachPanel.addEventListener('mouseleave', scheduleCoachHoverExit);
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
  state.flashcards = await window.bol.listFlashcards();
  updateFlashcardCount();
  elements.languageLabel.textContent = `Learning ${state.settings.targetLanguage || 'Hindi'}`;
  renderTrack();
  setSource('Finding Spotify…', false);
  setEmpty('Waiting for Spotify', 'Open Spotify on this Mac. Bol will follow the current track automatically.');
  await pollSpotify();
  scheduleSpotifyPoll();
  scheduleTick(0);
}

init();
