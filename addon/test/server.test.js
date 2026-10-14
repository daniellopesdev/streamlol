const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'streamlol-http-'));

const { createApp } = require('../src/server');

async function json(url, options) {
    const response = await fetch(url, options);
    const payload = await response.json();
    assert.equal(response.ok, true, payload.err || response.status);
    return payload;
}

test('a remembered library cookie skips creating a new library', async () => {
    const app = createApp();
    const server = await new Promise((resolve) => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        const welcome = await fetch(`${base}/`, { redirect: 'manual' });
        assert.equal(welcome.status, 200);
        assert.match(await welcome.text(), /Create my library/);

        const created = await fetch(`${base}/configure`, { redirect: 'manual' });
        const token = created.headers.get('location').split('/')[1];
        const page = await fetch(`${base}/${token}/`);
        const cookie = page.headers.get('set-cookie');
        assert.match(cookie, new RegExp(`streamlol_token=${token}`));
        const jar = cookie.split(';')[0];

        const home = await fetch(`${base}/`, { redirect: 'manual', headers: { cookie: jar } });
        assert.equal(home.status, 200, 'home page stays reachable when a library is remembered');
        const again = await fetch(`${base}/configure`, { redirect: 'manual', headers: { cookie: jar } });
        assert.equal(again.headers.get('location'), `/${token}/`);
        const fresh = await fetch(`${base}/configure?new=1`, { redirect: 'manual', headers: { cookie: jar } });
        assert.notEqual(fresh.headers.get('location'), `/${token}/`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('a saved Stremio session is reported by email only and can be forgotten', async () => {
    const app = createApp();
    const server = await new Promise((resolve) => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        const created = await fetch(`${base}/configure`, { redirect: 'manual' });
        const token = created.headers.get('location').split('/')[1];

        const none = await json(`${base}/api/${token}/stremio/device`);
        assert.deepEqual(none, { email: null, saved: false });
        const missing = await fetch(`${base}/api/${token}/stremio`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device: true }),
        });
        assert.equal(missing.status, 400);

        const value = Buffer.from(JSON.stringify({ authKey: 'secret-key', email: 'me@example.com' })).toString('base64url');
        const saved = await fetch(`${base}/api/${token}/stremio/device`, { headers: { cookie: `streamlol_stremio=${value}` } });
        const body = await saved.text();
        assert.deepEqual(JSON.parse(body), { email: 'me@example.com', saved: true });
        assert.equal(body.includes('secret-key'), false);

        const forgot = await fetch(`${base}/api/${token}/stremio/device`, { method: 'DELETE' });
        assert.match(forgot.headers.get('set-cookie'), /streamlol_stremio=; Max-Age=0; Path=\/; HttpOnly/);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test('catalogs are generated from the live library file', async () => {
    const app = createApp();
    const server = await new Promise((resolve) => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    try {
        const created = await fetch(`${base}/configure`, { redirect: 'manual' });
        const token = created.headers.get('location').split('/')[1];
        const film = {
            imdbId: 'tt0111161',
            title: 'The Shawshank Redemption',
            year: '1994',
            poster: 'https://image.example/shawshank.jpg',
            genres: ['Drama'],
            imdbRating: '9.3',
            platforms: ['Prime Video'],
        };
        await json(`${base}/api/${token}/films`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(film),
        });
        const list = await json(`${base}/api/${token}/lists`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Comfort' }),
        });
        await json(`${base}/api/${token}/lists/${list.id}/films`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imdbId: film.imdbId }),
        });
        const manifest = await json(`${base}/${token}/manifest.json`);
        assert.equal(manifest.catalogs.some((catalog) => catalog.id === `list_${list.id}` && catalog.name === 'Shelves · Comfort'), true);
        const catalog = await json(`${base}/${token}/catalog/movie/list_${list.id}.json`);
        assert.equal(catalog.metas[0].id, film.imdbId);
        assert.equal(catalog.metas[0].type, 'movie');
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});
