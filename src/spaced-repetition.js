const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

function defaultStudyState() {
  return {
    phase: 'new',
    step: 0,
    intervalDays: 0,
    ease: 2.5,
    dueAt: null,
    reviews: 0,
    lapses: 0,
    lastReviewedAt: null,
    lastRating: null,
  };
}

function normalizeStudyState(study = {}) {
  const base = defaultStudyState();
  if (['new', 'learning', 'review', 'relearning'].includes(study.phase)) return { ...base, ...study };
  return {
    ...base,
    reviews: Number(study.seen || 0),
    lapses: Number(study.again || 0),
    lastReviewedAt: study.lastReviewedAt || null,
  };
}

function addTime(now, milliseconds) {
  return new Date(now + milliseconds).toISOString();
}

function reviewIntervals(study) {
  const previous = Math.max(1, Number(study.intervalDays || 1));
  const hard = Math.max(previous + 1, Math.round(previous * 1.2));
  const good = Math.max(previous + 1, Math.round(previous * Number(study.ease || 2.5)));
  const easy = Math.max(good + 1, Math.round(good * 1.3));
  return { again: { milliseconds: 10 * MINUTE, label: '10m' }, hard: { days: hard, label: `${hard}d` }, good: { days: good, label: `${good}d` }, easy: { days: easy, label: `${easy}d` } };
}

function ratingIntervals(rawStudy) {
  const study = normalizeStudyState(rawStudy);
  if (study.phase === 'review') return reviewIntervals(study);
  if (study.phase === 'relearning') {
    const easyDays = Math.max(4, Math.round(Math.max(1, study.intervalDays) * study.ease));
    return {
      again: { milliseconds: 10 * MINUTE, label: '10m' },
      hard: { milliseconds: 15 * MINUTE, label: '15m' },
      good: { days: 1, label: '1d' },
      easy: { days: easyDays, label: `${easyDays}d` },
    };
  }
  if (study.step > 0) {
    return {
      again: { milliseconds: MINUTE, label: '1m' },
      hard: { milliseconds: 10 * MINUTE, label: '10m' },
      good: { days: 1, label: '1d' },
      easy: { days: 4, label: '4d' },
    };
  }
  return {
    again: { milliseconds: MINUTE, label: '1m' },
    hard: { milliseconds: 6 * MINUTE, label: '6m' },
    good: { milliseconds: 10 * MINUTE, label: '10m' },
    easy: { days: 4, label: '4d' },
  };
}

function scheduleReview(rawStudy, rating, now = Date.now()) {
  if (!['again', 'hard', 'good', 'easy'].includes(rating)) throw new Error('Unknown flashcard rating.');
  const study = normalizeStudyState(rawStudy);
  const interval = ratingIntervals(study)[rating];
  const next = {
    ...study,
    reviews: study.reviews + 1,
    lastReviewedAt: new Date(now).toISOString(),
    lastRating: rating,
  };
  if (rating === 'again') {
    if (study.phase === 'review') {
      next.lapses += 1;
      next.ease = Math.max(1.3, study.ease - 0.2);
    }
    next.phase = study.phase === 'review' || study.phase === 'relearning' ? 'relearning' : 'learning';
    next.step = 0;
  } else if (rating === 'hard') {
    if (study.phase === 'review') {
      next.intervalDays = interval.days;
      next.ease = Math.max(1.3, study.ease - 0.15);
    } else {
      next.phase = study.phase === 'relearning' ? 'relearning' : 'learning';
    }
  } else if (rating === 'good') {
    if (study.phase === 'review') next.intervalDays = interval.days;
    else if (study.phase === 'new' || (study.phase === 'learning' && study.step === 0)) {
      next.phase = 'learning';
      next.step = 1;
    } else {
      next.phase = 'review';
      next.step = 0;
      next.intervalDays = interval.days;
    }
  } else {
    next.phase = 'review';
    next.step = 0;
    next.intervalDays = interval.days;
    next.ease = Math.min(3.5, study.ease + 0.15);
  }
  next.dueAt = interval.days ? addTime(now, interval.days * DAY) : addTime(now, interval.milliseconds);
  return next;
}

function isDue(study, now = Date.now()) {
  const normalized = normalizeStudyState(study);
  return !normalized.dueAt || Date.parse(normalized.dueAt) <= now;
}

function dueCards(cards, now = Date.now()) {
  return cards.filter((card) => isDue(card.study, now)).sort((a, b) => {
    const aDueAt = normalizeStudyState(a.study).dueAt;
    const bDueAt = normalizeStudyState(b.study).dueAt;
    const aDue = aDueAt ? Date.parse(aDueAt) : Number.NEGATIVE_INFINITY;
    const bDue = bDueAt ? Date.parse(bDueAt) : Number.NEGATIVE_INFINITY;
    return aDue - bDue;
  });
}

module.exports = { MINUTE, DAY, defaultStudyState, normalizeStudyState, ratingIntervals, scheduleReview, isDue, dueCards };
