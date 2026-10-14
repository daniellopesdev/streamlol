const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'streamlol-'));

const { createToken, update, load } = require('../src/store');
const actions = require('../src/library');
const { shelfMetas } = require('../src/catalog');
const { manifestFor } = require('../src/manifest');
const { matchesLocal, matchesFilm } = require('../src/discover');

const matrix = {
    imdbId: 'tt0133093',
    title: 'The Matrix',
    year: '1999',
    poster: 'https://image.example/matrix.jpg',
    genres: ['Action', 'Sci-Fi'],
    imdbRating: '8.7',
    platforms: ['Netflix'],
};

test('library and viewed stay separate, and a review marks the film viewed', async () => {
    const token = createToken();
    await update(token, (library) => actions.upsertFilm(library, matrix, 'library'));
    let stored = await load(token);
    assert.deepEqual(shelfMetas(stored, 'library').map((meta) => meta.id), ['tt0133093']);
    assert.deepEqual(shelfMetas(stored, 'viewed'), []);

    await update(token, (library) => actions.setReview(library, 'tt0133093', { score: 9, note: 'Still holds' }));
    stored = await load(token);
    assert.deepEqual(shelfMetas(stored, 'library'), []);
    assert.equal(shelfMetas(stored, 'viewed')[0].description.includes('Your score: 9/10'), true);
    assert.equal(shelfMetas(stored, 'reviewed')[0].description.includes('Still holds'), true);

    await update(token, (library) => actions.clearReview(library, 'tt0133093'));
    stored = await load(token);
    assert.equal(stored.status.tt0133093, 'viewed');
    assert.equal(stored.reviews.tt0133093, undefined);
});

test('a film can sit on two lists and the manifest picks up a new list immediately', async () => {
    const token = createToken();
    await update(token, (library) => {
        actions.upsertFilm(library, matrix, 'library');
        const first = actions.addList(library, 'Sunday');
        const second = actions.addList(library, 'Rewatch');
        actions.addFilmToList(library, first.id, matrix.imdbId);
        actions.addFilmToList(library, second.id, matrix.imdbId);
        actions.reorderLists(library, [second.id, first.id]);
    });
    const stored = await load(token);
    assert.equal(stored.lists[0].name, 'Rewatch');
    await update(token, (library) => actions.setStatus(library, matrix.imdbId, 'viewed'));
    const viewed = await load(token);
    assert.deepEqual(shelfMetas(viewed, `list_${stored.lists[0].id}`), []);
    assert.equal(stored.lists[1].name, 'Sunday');
    const manifest = manifestFor(stored);
    assert.equal(manifest.catalogs.some((catalog) => catalog.name === 'Shelves · Rewatch'), true);
    assert.equal(manifest.catalogs.some((catalog) => catalog.name === 'Shelves · Sunday'), true);
    assert.equal(manifest.catalogs[0].name, 'Shelves · Library');
    assert.deepEqual(manifest.idPrefixes, ['tt']);
    assert.equal(manifest.resources.includes('stream'), false);
});

test('discover filters combine genre, excluded genre, and year', () => {
    const movie = { genre_ids: [28, 878], release_date: '1999-03-31' };
    assert.equal(matchesLocal(movie, { genres: ['28'], excludeGenres: [], yearFrom: '1990', yearTo: '2000' }), true);
    assert.equal(matchesLocal(movie, { genres: ['28', '35'], excludeGenres: [] }), false);
    assert.equal(matchesLocal(movie, { genres: ['28'], excludeGenres: ['878'] }), false);
    assert.equal(matchesLocal(movie, { genres: ['28'], yearFrom: '2000' }), false);
});

test('series get their own catalogs and never leak into movie rows', async () => {
    const token = createToken();
    await update(token, (library) => {
        actions.upsertFilm(library, matrix, 'library');
        actions.upsertFilm(library, { imdbId: 'tt0903747', type: 'series', title: 'Breaking Bad', genres: ['Drama'] }, 'viewed');
    });
    const stored = await load(token);
    assert.deepEqual(shelfMetas(stored, 'library', {}, 'movie').map((meta) => meta.id), ['tt0133093']);
    assert.deepEqual(shelfMetas(stored, 'library', {}, 'series'), []);
    assert.equal(shelfMetas(stored, 'viewed', {}, 'series')[0].type, 'series');
    const manifest = manifestFor(stored);
    assert.deepEqual(manifest.types, ['movie', 'series']);
    assert.equal(manifest.catalogs.some((catalog) => catalog.id === 'viewed' && catalog.type === 'series'), true);
    assert.equal(manifest.catalogs.some((catalog) => catalog.id === 'library' && catalog.type === 'series'), false);
});

test('viewed date can be moved for calendar grouping', async () => {
    const token = createToken();
    await update(token, (library) => actions.upsertFilm(library, matrix, 'viewed'));
    const day = Date.UTC(2026, 0, 15);
    await update(token, (library) => actions.setViewedAt(library, matrix.imdbId, day));
    assert.equal((await load(token)).films[matrix.imdbId].viewedAt, day);
    await assert.rejects(update(token, (library) => actions.setViewedAt(library, matrix.imdbId, 'soon')));
});

test('token-free discover filters stack genre aliases, years, and IMDb rating', () => {
    assert.equal(matchesFilm(matrix, { genres: ['Science Fiction'], minImdb: '8', yearFrom: '1990', yearTo: '1999' }), true);
    assert.equal(matchesFilm(matrix, { genres: ['Action'], excludeGenres: ['Sci-Fi'] }), false);
    assert.equal(matchesFilm(matrix, { minImdb: '9' }), false);
    assert.equal(matchesFilm(matrix, { yearFrom: '2000' }), false);
});
