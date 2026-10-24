const test = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { performance } = require('node:perf_hooks');
const { discover } = require('../src/discover');
const { emptyLibrary } = require('../src/store');
const { measureCache } = require('../src/cache');

for (const sort of ['popular', 'rating']) {
    test(`filtered ${sort} discovery batches metadata without losing IMDb scores or provider data`, async (t) => {
        const base = sort === 'popular' ? 710000 : 720000;
        const totalPages = sort === 'rating' ? 3 : 1;
        let calls = 0;
        let referenceCalls = 0;
        let active = 0;
        let peak = 0;
        t.mock.method(global, 'fetch', async (input) => {
            const url = new URL(input);
            calls += 1;
            active += 1;
            peak = Math.max(peak, active);
            await delay(20);
            active -= 1;
            if (url.hostname === 'v3-cinemeta.strem.io') {
                const id = Number(/tt(\d+)/.exec(url.pathname)[1]) - base;
                return Response.json({ meta: { imdbRating: String(8 + id / 100) } });
            }
            if (url.pathname.includes('/genre/')) {
                referenceCalls += 1;
                return Response.json({ genres: [{ id: 18, name: 'Drama' }] });
            }
            if (url.pathname === '/3/watch/providers/movie') {
                referenceCalls += 1;
                return Response.json({ results: [{ provider_id: 8, provider_name: 'Netflix' }] });
            }
            if (url.pathname === '/3/discover/movie') {
                const page = Number(url.searchParams.get('page'));
                return Response.json({ total_pages: totalPages, results: Array.from({ length: 20 }, (_, i) => ({
                    id: base + (page - 1) * 20 + i + 1, title: `Film ${i + 1}`, genre_ids: [18], release_date: '2020-01-01',
                })) });
            }
            const id = Number(url.pathname.split('/')[3]);
            const providers = { US: { flatrate: [{ provider_id: 8 }] } };
            // Support the separate and appended requests to measure the old/new paths identically.
            if (url.pathname.endsWith('/external_ids')) return Response.json({ imdb_id: `tt${id}` });
            if (url.pathname.endsWith('/watch/providers')) return Response.json({ results: providers });
            if (url.pathname === `/3/movie/${id}`) {
                assert.equal(url.searchParams.get('append_to_response'), 'external_ids,watch/providers');
                return Response.json({ external_ids: { imdb_id: `tt${id}` }, 'watch/providers': { results: providers } });
            }
            throw new Error(`Unexpected metadata request: ${url.pathname}`);
        });
        const library = emptyLibrary();
        library.settings.tmdbToken = 'mock-token';
        const start = performance.now();
        const result = await discover(library, { type: 'movie', country: 'US', sort, genres: ['Drama'], yearFrom: sort === 'rating' ? '2019' : '2018' });
        t.diagnostic(`${calls} upstream calls, ${Math.round(performance.now() - start)}ms with 20ms simulated upstream latency, peak ${peak} requests`);
        assert.equal(result.results.length, 20);
        assert.equal(result.results.every((film) => film.platforms.includes('Netflix')), true);
        if (sort === 'rating') {
            assert.equal(result.results.every((film) => film.imdbRating), true);
            assert.equal(result.results[0].imdbId, `tt${base + 60}`);
            assert.equal(result.nextCursor, '20');
            // Rating sort: catalog page + movie facts + Cinemeta rating per title.
            assert.equal(calls, referenceCalls + totalPages + totalPages * 20 * 2);
        } else {
            // Popular browse skips Cinemeta unless minImdb is set — one facts call per title.
            assert.equal(calls, referenceCalls + totalPages + totalPages * 20);
        }
        assert.ok(peak <= 10);
        const before = calls;
        const warmStart = performance.now();
        const warm = await measureCache(() => discover(library, { type: 'movie', country: 'US', sort, genres: ['Drama'], yearFrom: sort === 'rating' ? '2019' : '2018' }));
        assert.deepEqual(warm.value, result);
        assert.equal(calls, before);
        assert.equal(warm.stats.misses, 0);
        assert.equal(warm.stats.memoryHits, 1 + totalPages, 'read a reference bundle and complete pages, without per-film lookups');
        t.diagnostic(`repeat: ${Math.round(performance.now() - warmStart)}ms, ${warm.stats.memoryHits} cache reads, zero upstream requests`);
    });
}

test('an aborted filter finishes its shareable page but requests no later catalog pages', async (t) => {
    const controller = new AbortController();
    let facts = 0;
    let ratings = 0;
    let pages = 0;
    t.mock.method(global, 'fetch', async (input) => {
        const url = new URL(input);
        if (url.hostname === 'v3-cinemeta.strem.io') {
            ratings += 1;
            return Response.json({ meta: { imdbRating: '9' } });
        }
        if (url.pathname.includes('/genre/')) return Response.json({ genres: [] });
        if (url.pathname.includes('/watch/providers/')) return Response.json({ results: [] });
        if (url.pathname.includes('/discover/')) {
            pages += 1;
            return Response.json({ total_pages: 10, results: Array.from({ length: 20 }, (_, i) => ({ id: 730000 + i })) });
        }
        if (url.pathname.startsWith('/3/movie/')) {
            facts += 1;
            controller.abort();
            return Response.json({ external_ids: { imdb_id: 'tt730000' } });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
    });
    const library = emptyLibrary();
    library.settings.tmdbToken = 'mock-token';
    await assert.rejects(discover(library, { country: 'GB', sort: 'popular' }, null, { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(facts, 20);
    assert.equal(pages, 1);
    assert.equal(ratings, 0, 'popular browse no longer waits on Cinemeta ratings');
});

test('title search fills the grid from TMDB without waiting on Cinemeta ratings', async (t) => {
    t.mock.method(global, 'fetch', async (input) => {
        const url = new URL(input);
        if (url.hostname === 'v3-cinemeta.strem.io') throw new Error('title search must not call Cinemeta');
        if (url.pathname.includes('/genre/')) return Response.json({ genres: [] });
        if (url.pathname.includes('/watch/providers/')) return Response.json({ results: [] });
        if (url.pathname.includes('/search/movie')) {
            return Response.json({
                total_pages: 1,
                results: [{ id: 109424, title: 'The Act of Killing', release_date: '2012-11-01', genre_ids: [99], poster_path: '/x.jpg', overview: 'doc' }],
            });
        }
        if (url.pathname === '/3/movie/109424/external_ids') return Response.json({ imdb_id: 'tt2375605' });
        throw new Error(`Unexpected request: ${url.pathname}`);
    });
    const library = emptyLibrary();
    library.settings.tmdbToken = 'mock-token';
    library.status.tt2375605 = 'viewed';
    const hidden = await discover(library, { country: 'US', q: 'The Act of Killing', sort: 'rating', hideViewed: true });
    assert.equal(hidden.results.length, 0, 'hideViewed still applies after enrichment');
    const shown = await discover(library, { country: 'US', q: 'The Act of Killing', sort: 'rating', hideViewed: false });
    assert.equal(shown.results.length, 1);
    assert.equal(shown.results[0].title, 'The Act of Killing');
    assert.equal(shown.results[0].imdbId, 'tt2375605');
});

test('failed rating enrichment is retried rather than persisting an empty filtered page', async (t) => {
    let ratingCalls = 0;
    t.mock.method(global, 'fetch', async (input) => {
        const url = new URL(input);
        if (url.hostname === 'v3-cinemeta.strem.io') {
            ratingCalls += 1;
            return ratingCalls === 1 ? new Response('', { status: 503 }) : Response.json({ meta: { imdbRating: '8.8' } });
        }
        if (url.pathname.includes('/genre/')) return Response.json({ genres: [] });
        if (url.pathname.includes('/watch/providers/')) return Response.json({ results: [] });
        if (url.pathname.includes('/search/')) return Response.json({ total_pages: 1, results: [{ id: 735000, title: 'Retry film' }] });
        if (url.pathname === '/3/movie/735000/external_ids' || url.pathname === '/3/movie/735000') {
            return Response.json({ imdb_id: 'tt735000', external_ids: { imdb_id: 'tt735000' } });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
    });
    const library = emptyLibrary();
    library.settings.tmdbToken = 'mock-token';
    const filters = { country: 'FI', q: 'retry-cache-test', minImdb: '8' };
    await assert.rejects(discover(library, filters), { status: 502, code: 'metadata_unavailable' });
    assert.equal((await discover(library, filters)).results.length, 1);
    assert.equal(ratingCalls, 2);
    assert.equal((await discover(library, filters)).results.length, 1);
    assert.equal(ratingCalls, 2);
});
