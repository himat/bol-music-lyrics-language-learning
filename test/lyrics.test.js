const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseBestLyrics, normalize, fetchLyrics } = require('../src/lyrics');

const iAmInLoveTrack = { title: 'I Am In Love', artist: 'Pritam', album: 'Once Upon A Time In Mumbaai', durationMs: 285000 };

test('finds I Am In Love by album when LRCLIB credits the singer instead of Pritam', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(new URL(url));
    if (url.includes('/get?')) return { ok: false, status: 404 };
    return { ok: true, json: async () => url.includes('album_name=') ? [{
      id: 23298734, trackName: 'I Am In Love', artistName: 'K.K.',
      albumName: 'Once Upon A Time In Mumbaai', duration: 285, plainLyrics: 'lyric fixture',
    }, {
      id: 19433996, trackName: 'I Am In Love', artistName: 'Karthik',
      albumName: 'Once Upon A Time In Mumbaai', duration: 287, syncedLyrics: '[00:29.00] English translation fixture',
    }] : [] };
  });
  const lyrics = await fetchLyrics(iAmInLoveTrack);
  assert.equal(lyrics.id, 23298734);
  assert.equal(lyrics.artistName, 'K.K.');
  assert.equal(lyrics.synced, false);
  assert.equal(lyrics.lines.length, 1);
  assert.equal(requests.length, 3);
  assert.equal(requests[2].searchParams.get('album_name'), iAmInLoveTrack.album);
  assert.equal(requests[2].searchParams.has('artist_name'), false);
});

test('album fallback rejects unrelated albums, versions, missing duration and empty lyrics', async (t) => {
  const base = { trackName: iAmInLoveTrack.title, albumName: iAmInLoveTrack.album, duration: 285, plainLyrics: 'wrong recording' };
  const mismatches = [
    { ...base, albumName: 'Another Album' },
    { ...base, trackName: 'I Am In Love (Female)' },
    { ...base, duration: 302 },
    { ...base, duration: null },
    { ...base, plainLyrics: '' },
  ];
  t.mock.method(globalThis, 'fetch', async (url) => url.includes('/get?')
    ? { ok: false, status: 404 }
    : { ok: true, json: async () => url.includes('album_name=') ? mismatches : [] });
  await assert.rejects(fetchLyrics(iAmInLoveTrack), /No lyrics found/);
});

test('does not relax artist matching when a match already exists or album identity is absent', async (t) => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    count++;
    return url.includes('/get?') ? { ok: false, status: 404 }
      : { ok: true, json: async () => [{ id: 1, duration: 285, plainLyrics: 'existing match' }] };
  });
  assert.equal((await fetchLyrics(iAmInLoveTrack)).id, 1);
  assert.equal(count, 2);
  t.mock.method(globalThis, 'fetch', async (url) => url.includes('/get?')
    ? { ok: false, status: 404 } : { ok: true, json: async () => [] });
  await assert.rejects(fetchLyrics({ ...iAmInLoveTrack, album: '' }), /No lyrics found/);
});

// LRCLIB record 36074487, Tum Jo Aaye (Reprise): each original is followed
// by its English meaning at the identical timestamp. Keep this offline.
const repriseBilingual = {
  id: 36074487, trackName: 'Tum Jo Aaye (Reprise)', duration: 286,
  syncedLyrics: [
    '[00:11.65] Paaya, maine paaya tumhein, Rabb ne milaya tumhein',
    '[00:11.65] (I found, I found you, God brought us together)',
    '[00:14.48] Honthon pe sajaya tumhein, naghme sa gaaya tumhein',
    '[00:14.48] (I adorned you on my lips, I sang you like a melody)',
    '[00:17.33] Paaya, maine paaya tumhein, sabse chhupaya tumhein',
    '[00:17.33] (I found, I found you, I hid you from everyone)',
    '[02:40.02] Pa ma ga ma pa ga ga ga ma ga ma ga ga sa',
    '[02:40.02] (Classical music notes / Sargam)',
  ].join('\n'),
};

test('Tum Jo Aaye Reprise removes embedded translation rows even with no clean alternative', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => url.includes('/get?')
    ? { ok: false, status: 404 }
    : { ok: true, json: async () => [repriseBilingual] });
  const result = await fetchLyrics({ title: 'Tum Jo Aaye (Reprise)', artist: 'Pritam', durationMs: 267000 });
  assert.equal(result.synced, true);
  assert.deepEqual(result.lines.map(({ index, timeMs }) => ({ index, timeMs })), [
    { index: 0, timeMs: 11650 }, { index: 1, timeMs: 14480 }, { index: 2, timeMs: 17330 }, { index: 3, timeMs: 160020 },
  ]);
  assert.ok(result.lines.every((line) => !line.text.startsWith('(')));
  assert.equal(result.lines[0].text, 'Paaya, maine paaya tumhein, Rabb ne milaya tumhein');
});

test('prefers a clean Reprise record without treating translations as extra coverage', () => {
  const clean = { ...repriseBilingual, id: 2, syncedLyrics: repriseBilingual.syncedLyrics.split('\n').filter((_, index) => index % 2 === 0).join('\n') };
  assert.equal(chooseBestLyrics(repriseBilingual, [clean], 286000).id, 2);
});

test('keeps genuine English lyrics, isolated backing vocals, and repeated original cues', () => {
  const english = '[00:01.00] I found you\n[00:01.00] (you found me)\n[00:02.00] We are together';
  assert.equal(normalize({ syncedLyrics: english }).lines.length, 3);
  const original = '[00:01.00] paaya tumhein\n[00:01.00] paaya tumhein\n[00:02.00] (oh)';
  assert.equal(normalize({ syncedLyrics: original }).lines.length, 3);
  const standaloneEnglish = `${repriseBilingual.syncedLyrics}\n[00:20.00] I will always love you`;
  assert.ok(normalize({ syncedLyrics: standaloneEnglish }).lines.some((line) => line.text === 'I will always love you'));
});

test('prefers duration-matched synchronized lyrics over an exact plain record', () => {
  const exact = { id: 1, duration: 277, plainLyrics: 'plain', syncedLyrics: null };
  const synced = { id: 2, duration: 276.96, plainLyrics: 'plain', syncedLyrics: '[00:10.00] line' };
  const wrongVersion = { id: 3, duration: 210, syncedLyrics: '[00:10.00] wrong version' };
  assert.equal(chooseBestLyrics(exact, [exact, wrongVersion, synced], 276000).id, 2);
});

test('keeps exact plain lyrics when no synchronized match exists', () => {
  const exact = { id: 1, duration: 200, plainLyrics: 'plain', syncedLyrics: null };
  assert.equal(chooseBestLyrics(exact, [], 200000), exact);
});

test('rejects a short exact synced record when a complete duration match exists', () => {
  const shortExact = { id: 1, duration: 309, syncedLyrics: '[00:10.00] refrain\n[00:20.00] refrain' };
  const complete = { id: 2, duration: 308, syncedLyrics: Array.from({ length: 24 }, (_, index) => `[${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}.00] line ${index}`).join('\n') };
  assert.equal(chooseBestLyrics(shortExact, [shortExact, complete], 308000).id, 2);
});

test('prefers complete Devanagari lyrics over an equally complete split romanization', () => {
  const romanized = {
    id: 1,
    duration: 196,
    syncedLyrics: '[00:01.00] ek\n[00:02.00] do\n[00:03.00] teen\n[00:04.00] chaar\n[00:05.00] paanch\n[00:06.00] chhah',
  };
  const devanagari = {
    id: 2,
    duration: 196,
    syncedLyrics: '[00:01.00] एक दो\n[00:03.00] तीन चार\n[00:06.00] पाँच छह',
  };

  assert.equal(chooseBestLyrics(null, [romanized, devanagari], 196000, 'Hindi').id, 2);
});

test('does not prefer native script when it omits a material part of the song', () => {
  const completeRomanized = {
    id: 1,
    duration: 196,
    syncedLyrics: '[00:01.00] ek do teen\n[00:06.00] chaar paanch chhah',
  };
  const incompleteDevanagari = {
    id: 2,
    duration: 196,
    syncedLyrics: '[00:01.00] एक दो',
  };

  assert.equal(chooseBestLyrics(null, [completeRomanized, incompleteDevanagari], 196000, 'Hindi').id, 1);
});

test('prefers complete Gurmukhi lyrics for Punjabi', () => {
  const romanized = { id: 1, duration: 200, syncedLyrics: '[00:01.00] tu kithe chaliye' };
  const gurmukhi = { id: 2, duration: 200, syncedLyrics: '[00:01.00] ਤੂੰ ਕਿੱਥੇ ਚੱਲੀਏ' };

  assert.equal(chooseBestLyrics(null, [romanized, gurmukhi], 200000, 'Punjabi').id, 2);
});

test('rejects a stacked romanization and English translation track in favor of clean native lyrics', () => {
  const bilingual = {
    id: 1,
    duration: 208,
    syncedLyrics: [
      '[00:04.33] naa ja, naa ja, naa ja',
      "[00:04.33] Don't go, don't go, don't go",
      "[00:09.81] ni kudi ayy tu alright, aaja nede, I won't bite",
      "[00:09.81] Girl, you are alright, come closer, I won't bite",
    ].join('\n'),
  };
  const gurmukhi = {
    id: 2,
    duration: 208,
    syncedLyrics: [
      '[00:04.39] ਨਾ ਜਾ, ਨਾ ਜਾ, ਨਾ ਜਾ',
      "[00:09.81] ਨੀ ਕੁੜੀ ਏ ਤੂੰ alright, ਆਜਾ ਨੇੜੇ, I won't bite",
    ].join('\n'),
  };

  assert.equal(chooseBestLyrics(null, [bilingual, gurmukhi], 208000, 'Hindi').id, 2);
});

test('rejects stacked translations when only romanized originals are available', () => {
  const bilingual = {
    id: 1,
    duration: 208,
    syncedLyrics: '[00:04.33] naa ja\n[00:04.33] do not go\n[00:09.81] aaja nede\n[00:09.81] come closer',
  };
  const clean = {
    id: 2,
    duration: 208,
    syncedLyrics: '[00:04.33] naa ja\n[00:09.81] aaja nede',
  };

  assert.equal(chooseBestLyrics(null, [bilingual, clean], 208000, 'Hindi').id, 2);
});
