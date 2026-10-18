const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'streamlol-security-'));
const { createApp } = require('../src/server');
const { emptyLibrary, DATA_DIR } = require('../src/store');
const actions = require('../src/library');
const { createLimiter } = require('../src/rateLimit');
const stremio = require('../src/stremio');

async function serve(t) {
    const server = await new Promise((resolve) => {
        const listening = createApp().listen(0, '127.0.0.1', () => resolve(listening));
    });
    t.after(() => new Promise((resolve) => server.close(resolve)));
    return `http://127.0.0.1:${server.address().port}`;
}

test('film mutations reject inherited properties without changing the shared prototype', () => {
    const library = emptyLibrary();
    const before = Object.getOwnPropertyDescriptor(Object.prototype, 'viewedAt');
    try {
        for (const mutate of [
            () => actions.setStatus(library, '__proto__', 'viewed'),
            () => actions.setReview(library, '__proto__', { score: 9 }),
            () => actions.setViewedAt(library, '__proto__', Date.now()),
            () => actions.upsertFilm(library, { imdbId: ['tt1234567'] }),
            () => actions.reorderLists(library, 'not-an-array'),
        ]) assert.throws(mutate, { status: 400 });
        assert.deepEqual(Object.getOwnPropertyDescriptor(Object.prototype, 'viewedAt'), before);
    } finally {
        if (before) Object.defineProperty(Object.prototype, 'viewedAt', before);
        else delete Object.prototype.viewedAt;
    }
});

test('library pages are read-only, unknown tokens are rejected and errors do not reveal storage details', async (t) => {
    const base = await serve(t);
    const welcome = await fetch(base, { headers: { cookie: 'streamlol_token=%broken' } });
    assert.equal(welcome.status, 200);
    assert.equal(welcome.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(welcome.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(welcome.headers.get('x-frame-options'), 'DENY');
    assert.equal(welcome.headers.get('x-powered-by'), null);

    const created = await fetch(`${base}/configure`, { redirect: 'manual' });
    const token = created.headers.get('location').split('/')[1];
    const file = path.join(DATA_DIR, `${token}.json`);
    fs.utimesSync(file, 1000, 1000);
    const page = await fetch(`${base}/${token}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('set-cookie'), /HttpOnly/);
    assert.equal((await fetch(`${base}/${token}/configure`)).status, 200);
    const forwarded = await fetch(`${base}/${token}/`, { headers: { 'x-forwarded-proto': 'javascript' } });
    assert.equal(forwarded.status, 200);
    assert.equal((await forwarded.text()).includes('javascript://'), false);
    assert.equal(fs.statSync(file).mtimeMs, 1000000, 'GET pages must not rewrite library storage');

    const unknown = 'f'.repeat(24);
    for (const route of [`/api/${unknown}`, `/api/${unknown}/stremio/device`, `/${unknown}/`, `/${unknown}/manifest.json`]) {
        assert.equal((await fetch(`${base}${route}`)).status, 404);
    }
    assert.equal((await fetch(`${base}/api/${unknown}/lists`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"invalid"}',
    })).status, 404);
    assert.equal(fs.existsSync(path.join(DATA_DIR, `${unknown}.json`)), false);

    const malformed = await fetch(`${base}/api/${token}/lists`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{secret-invalid-json',
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { err: 'Invalid JSON body' });

    const forget = await fetch(`${base}/api/${token}/device`, { method: 'DELETE' });
    assert.equal(forget.status, 200);
    assert.match(forget.headers.get('set-cookie'), /streamlol_token=; Max-Age=0/);
    assert.match(forget.headers.get('set-cookie'), /streamlol_stremio=; Max-Age=0/);

    fs.writeFileSync(file, '{invalid library');
    const failed = await fetch(`${base}/api/${token}`);
    assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), { err: 'Internal server error' });
});

test('rate limits expire locally, coordinate through Redis, and fail closed on Redis errors', async () => {
    let clock = 0;
    const req = { ip: '127.0.0.1' };
    const headers = {};
    const res = { setHeader: (name, value) => { headers[name] = value; } };
    const local = createLimiter({ client: () => null, now: () => clock });
    await local(req, res, 'login', 1, 10000);
    await assert.rejects(local(req, res, 'login', 1, 10000), { status: 429 });
    assert.equal(headers['Retry-After'], '10');
    clock = 10000;
    await local(req, res, 'login', 1, 10000);

    let count = 0;
    const remote = { eval: async (script, keys, args) => {
        assert.match(script, /PEXPIRE/);
        assert.match(keys[0], /^streamlol:limits:login:[a-f0-9]{64}$/);
        assert.deepEqual(args, [10000]);
        return [++count, 10000];
    } };
    await createLimiter({ client: () => remote })(req, res, 'login', 1, 10000);
    await assert.rejects(createLimiter({ client: () => remote })(req, res, 'login', 1, 10000), { status: 429 });
    const offline = createLimiter({ client: () => ({ eval: async () => { throw new Error('secret infrastructure detail'); } }) });
    await assert.rejects(offline(req, res, 'login', 1, 10000), { status: 503 });
});

test('HTTP creation and login limits stop requests before account APIs run', async (t) => {
    const base = await serve(t);
    const login = t.mock.method(stremio, 'connect', async () => { throw Object.assign(new Error('Invalid credentials'), { status: 401 }); });
    let token;
    for (let i = 0; i < 20; i += 1) {
        const created = await fetch(`${base}/configure?new=1`, { redirect: 'manual' });
        assert.equal(created.status, 302);
        token = created.headers.get('location').split('/')[1];
    }
    const blocked = await fetch(`${base}/configure?new=1`, { redirect: 'manual' });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    for (let i = 0; i < 11; i += 1) {
        const response = await fetch(`${base}/api/${token}/stremio`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        });
        assert.equal(response.status, i < 10 ? 401 : 429);
    }
    assert.equal(login.mock.callCount(), 10);
});
