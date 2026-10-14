const test = require('node:test');
const assert = require('node:assert/strict');
const { emptyLibrary } = require('../src/store');
const { stremioItems, mergeStremio } = require('../src/stremio');

const raw = [
    { _id: 'tt0111161', type: 'movie', name: 'Shawshank', poster: 'https://p/1.jpg', removed: false, temp: false, _ctime: '2024-01-02T00:00:00Z', state: { timesWatched: 1, lastWatched: '2024-02-03T00:00:00Z' } },
    { _id: 'tt0068646', type: 'movie', name: 'The Godfather', removed: false, temp: false, _ctime: '2024-03-01T00:00:00Z', state: {} },
    { _id: 'tt0903747', type: 'series', name: 'Breaking Bad', removed: true, temp: false, state: { flaggedWatched: 1 } },
    { _id: 'tt0000001', type: 'movie', name: 'Dropped', removed: true, temp: false, state: {} },
    { _id: 'tt0000002', type: 'movie', name: 'Peeked', removed: false, temp: true, state: {} },
    { _id: 'kitsu:1', type: 'series', name: 'Not IMDb', removed: false, state: {} },
    { _id: 'tt0000003', type: 'channel', name: 'Wrong type', removed: false, state: {} },
];

test('stremioItems keeps library titles and watched history only', () => {
    const items = stremioItems(raw);
    assert.deepEqual(items.map((item) => item.imdbId), ['tt0111161', 'tt0068646', 'tt0903747']);
    assert.equal(items[0].watched, true);
    assert.equal(items[0].watchedAt, Date.parse('2024-02-03T00:00:00Z'));
    assert.equal(items[1].watched, false);
    assert.equal(items[2].inLibrary, false);
    assert.equal(items[2].watched, true);
});

test('mergeStremio adds, upgrades to viewed, never downgrades', () => {
    const library = emptyLibrary();
    const first = mergeStremio(library, stremioItems(raw));
    assert.deepEqual(first, { added: 3, viewed: 2, removed: 0, total: 3 });
    assert.equal(library.status.tt0111161, 'viewed');
    assert.equal(library.status.tt0068646, 'library');
    assert.equal(library.films.tt0068646.origin, 'stremio');
    assert.equal(library.films.tt0068646.addedAt, Date.parse('2024-03-01T00:00:00Z'));
    assert.match(library.films.tt0068646.poster, /^https:\/\//);

    library.status.tt0068646 = 'viewed';
    const watchedNow = raw.map((item) => (item._id === 'tt0068646' ? { ...item, state: { timesWatched: 2 } } : item));
    const second = mergeStremio(library, stremioItems(watchedNow));
    assert.equal(second.added, 0);
    assert.equal(library.status.tt0068646, 'viewed');
});

test('titles that leave Stremio are removed only if untouched', () => {
    const library = emptyLibrary();
    mergeStremio(library, stremioItems(raw));
    library.lists.push({ id: 'l1', name: 'Keep', filmIds: [], order: 0 });
    const kept = { ...raw[1], _id: 'tt0071562', name: 'Godfather II' };
    mergeStremio(library, stremioItems([...raw, kept]));
    library.lists[0].filmIds.push('tt0071562');

    const result = mergeStremio(library, stremioItems([raw[0], raw[2]]));
    assert.equal(result.removed, 1);
    assert.equal(library.films.tt0068646, undefined);
    assert.ok(library.films.tt0071562, 'listed title stays');
    assert.ok(library.films.tt0111161, 'viewed title stays');
});
