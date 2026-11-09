const test = require('node:test');
const assert = require('node:assert/strict');
const { MINUTE, DAY, defaultStudyState, ratingIntervals, scheduleReview, dueCards } = require('../src/spaced-repetition');

const now = Date.parse('2026-11-09T18:00:00.000Z');

test('uses Anki-style default learning steps and graduates cards', () => {
  const fresh = defaultStudyState();
  assert.deepEqual(Object.fromEntries(Object.entries(ratingIntervals(fresh)).map(([rating, value]) => [rating, value.label])), {
    again: '1m', hard: '6m', good: '10m', easy: '4d',
  });
  const learning = scheduleReview(fresh, 'good', now);
  assert.equal(learning.phase, 'learning');
  assert.equal(Date.parse(learning.dueAt), now + 10 * MINUTE);
  const graduated = scheduleReview(learning, 'good', now + 10 * MINUTE);
  assert.equal(graduated.phase, 'review');
  assert.equal(graduated.intervalDays, 1);
  assert.equal(scheduleReview(fresh, 'again', now).ease, 2.5);
});

test('expands review intervals and sends forgotten cards to relearning', () => {
  const review = { ...defaultStudyState(), phase: 'review', intervalDays: 4, ease: 2.5 };
  const good = scheduleReview(review, 'good', now);
  assert.equal(good.intervalDays, 10);
  assert.equal(Date.parse(good.dueAt), now + 10 * DAY);
  const again = scheduleReview(review, 'again', now);
  assert.equal(again.phase, 'relearning');
  assert.equal(again.lapses, 1);
  assert.equal(Date.parse(again.dueAt), now + 10 * MINUTE);
});

test('returns only cards whose scheduled review is due', () => {
  const cards = [
    { id: 'new', study: defaultStudyState() },
    { id: 'future', study: { ...defaultStudyState(), dueAt: new Date(now + DAY).toISOString() } },
    { id: 'overdue', study: { ...defaultStudyState(), dueAt: new Date(now - DAY).toISOString() } },
  ];
  assert.deepEqual(dueCards(cards, now).map((card) => card.id), ['new', 'overdue']);
});
