const test = require('node:test');
const assert = require('node:assert/strict');
const { tmdb, verifyCredential } = require('../src/tmdb');
const { cinemetaMeta, cinemetaCatalog } = require('../src/cinemeta');
const { discover } = require('../src/discover');
const { emptyLibrary } = require('../src/store');
const { scopePool } = require('../src/scopes');

// These tests exercise the API boundary without live services or credentials.
for (const key of ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']) {
    delete process.env[key];
}

test('TMDB shares public responses across credentials and canonicalizes parameters', async (t) => {
    const fetch = t.mock.method(global, 'fetch', async () => Response.json({ results: [{ id: 1 }] }));
    const results = await Promise.all([
        tmdb('a'.repeat(32), '/discover/movie', { page: 1, language: 'en' }),
        tmdb('bearer-token', '/discover/movie', { language: 'en', page: 1 }),
    ]);
    assert.equal(fetch.mock.callCount(), 1);
    results[0].results[0].id = 99;
    assert.equal(results[1].results[0].id, 1);
    await tmdb('other-token', '/discover/movie', { page: 1, language: 'pt' });
    await tmdb('other-token', '/discover/tv', { page: 1, language: 'en' });
    assert.equal(fetch.mock.callCount(), 3, 'language and media type stay distinct');
});

test('credential checks, private lists and account data always reach TMDB', async (t) => {
    const fetch = t.mock.method(global, 'fetch', async () => Response.json({ success: true }));
    for (let i = 0; i < 2; i += 1) {
        await verifyCredential('user-token');
        await tmdb('user-token', '/list/123');
        await tmdb('user-token', '/movie/123/account_states', { session_id: 'private' });
        await tmdb('user-token', '/movie/123', { append_to_response: 'account_states' });
        await tmdb('user-token', '/movie/123', { guest_session_id: 'private' });
    }
    assert.equal(fetch.mock.callCount(), 10);
});

test('assembled list pools are isolated by credential and callers cannot mutate cached items', async (t) => {
    const fetch = t.mock.method(global, 'fetch', async (url, options) => Response.json({
        items: [{ id: options.headers.Authorization === 'Bearer alice' ? 1 : 2 }],
    }));
    const scope = { kind: 'list', id: '456' };
    const alice = await scopePool('alice', scope, 'movie');
    assert.equal(alice[0].id, 1);
    alice[0].id = 99;
    assert.equal((await scopePool('bob', scope, 'movie'))[0].id, 2);
    assert.equal((await scopePool('alice', scope, 'movie'))[0].id, 1);
    assert.equal(fetch.mock.callCount(), 2);
});

test('Cinemeta retries failures and shares successful metadata and catalogs', async (t) => {
    let calls = 0;
    t.mock.method(global, 'fetch', async (url) => {
        calls += 1;
        if (calls === 1) return new Response('', { status: 503 });
        return Response.json(String(url).includes('/meta/') ? { meta: { id: 'tt12345678' } } : { metas: [{ id: 'tt12345678' }] });
    });
    assert.equal(await cinemetaMeta('movie', 'tt12345678'), null);
    assert.equal((await cinemetaMeta('movie', 'tt12345678')).id, 'tt12345678');
    await cinemetaMeta('movie', 'tt12345678');
    await cinemetaCatalog('movie', 'top', { genre: 'Drama', skip: 100 });
    await cinemetaCatalog('movie', 'top', { skip: 100, genre: 'Drama' });
    assert.equal(calls, 3);
});

test('Discover reuses upstream data across users while applying each viewed filter separately', async (t) => {
    const fetch = t.mock.method(global, 'fetch', async (input) => {
        const url = new URL(input);
        if (url.hostname === 'v3-cinemeta.strem.io') return Response.json({ meta: { imdbRating: '8.5' } });
        if (url.pathname.includes('/genre/')) return Response.json({ genres: [] });
        if (url.pathname === '/3/watch/providers/movie') return Response.json({ results: [] });
        if (url.pathname.includes('/discover/')) return Response.json({
            total_pages: 1, results: [{ id: 98765, title: 'Shared film' }],
        });
        if (url.pathname === '/3/movie/98765') return Response.json({ external_ids: { imdb_id: 'tt98765432' }, 'watch/providers': { results: {} } });
        throw new Error(`Unexpected request: ${url.pathname}`);
    });
    const alice = emptyLibrary();
    alice.settings.tmdbToken = 'alice-token';
    const bob = emptyLibrary();
    bob.settings.tmdbToken = 'bob-token';
    bob.status.tt98765432 = 'viewed';
    const filters = { type: 'movie', country: 'PT', sort: 'popular', yearFrom: '2021' };
    const first = await discover(bob, filters);
    assert.equal(first.results.length, 0, 'a user with this title viewed warms the public cache');
    const coldCalls = fetch.mock.callCount();
    assert.ok(coldCalls <= 5);
    assert.equal(fetch.mock.calls.filter(({ arguments: [input] }) => {
        const url = new URL(input);
        return url.hostname === 'v3-cinemeta.strem.io' || url.pathname.includes('/discover/') || url.pathname === '/3/movie/98765';
    }).length, 3);
    assert.equal((await discover(bob, filters)).results.length, 0);
    assert.equal(fetch.mock.callCount(), coldCalls);
    assert.equal((await discover(alice, filters)).results.length, 1);
    assert.equal(fetch.mock.callCount(), coldCalls);
    assert.equal((await discover(bob, { ...filters, hideViewed: false })).results.length, 1, 'viewed filtering must not be part of the shared cached result');
    assert.equal(fetch.mock.callCount(), coldCalls);
});
