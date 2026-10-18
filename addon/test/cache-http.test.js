const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'streamlol-cache-http-'));
const { createApp } = require('../src/server');
const { createToken, update } = require('../src/store');

test('Discover reports real cache misses and subsequent page hits without exposing credentials', async (t) => {
    const request = global.fetch;
    t.mock.method(global, 'fetch', async (input, options) => {
        const url = new URL(input);
        if (url.hostname === '127.0.0.1') return request(input, options);
        if (url.hostname === 'v3-cinemeta.strem.io') return Response.json({ meta: { imdbRating: '8.7' } });
        if (url.pathname.includes('/genre/')) return Response.json({ genres: [] });
        if (url.pathname.includes('/watch/providers/')) return Response.json({ results: [] });
        if (url.pathname.includes('/search/')) return Response.json({ total_pages: 1, results: [{ id: 940001, title: 'Cache HTTP test' }] });
        if (url.pathname === '/3/movie/940001') return Response.json({ external_ids: { imdb_id: 'tt940001' } });
        throw new Error(`Unexpected request: ${url.pathname}`);
    });
    const token = createToken();
    await update(token, (library) => { library.settings.tmdbToken = 'test-private-credential'; });
    const server = await new Promise((resolve) => {
        const listening = createApp().listen(0, '127.0.0.1', () => resolve(listening));
    });
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const url = `http://127.0.0.1:${server.address().port}/api/${token}/discover?country=ZZ&q=cache-http-test`;
    const cold = await request(url);
    assert.equal(cold.status, 200);
    assert.equal(cold.headers.get('x-streamlol-cache'), 'miss');
    const warm = await request(url);
    assert.equal(warm.status, 200);
    assert.equal(warm.headers.get('x-streamlol-cache'), 'hit');
    assert.match(warm.headers.get('server-timing'), /memory=2 redis=0 misses=0 writes=0 errors=0/);
    assert.equal(warm.headers.get('server-timing').includes(token), false);
    assert.equal(JSON.stringify(await warm.json()).includes('test-private-credential'), false);
});
