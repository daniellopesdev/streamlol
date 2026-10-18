const test = require('node:test');
const assert = require('node:assert/strict');
const { createCache } = require('../src/cache');

test('concurrent requests coalesce, payloads are isolated, TTL expires and memory is bounded', async () => {
    let clock = 0;
    let calls = 0;
    const cached = createCache({ client: () => null, now: () => clock, maxEntries: 2 });
    const load = async () => ({ results: [{ id: ++calls }] });
    const results = await Promise.all(Array.from({ length: 20 }, () => cached('film', 100, load)));
    assert.equal(calls, 1);
    results[0].results[0].id = 999;
    assert.equal(results[1].results[0].id, 1);
    assert.equal((await cached('film', 100, load)).results[0].id, 1);
    clock = 100;
    await cached('film', 100, load);
    assert.equal(calls, 2);
    await cached('other', 100, load);
    await cached('third', 100, load);
    await cached('film', 100, load);
    assert.equal(calls, 5);
});

test('Redis shares metadata between instances and preserves the original expiry', async () => {
    let clock = 0;
    let calls = 0;
    const data = new Map();
    const remote = {
        get: async (key) => data.get(key),
        set: async (key, value, options) => {
            assert.match(key, /^streamlol:metadata:v1:[a-f0-9]{64}$/);
            assert.equal(options.px, 100);
            data.set(key, value);
        },
    };
    const options = { client: () => remote, now: () => clock };
    const first = createCache(options);
    const second = createCache(options);
    const load = async () => ({ id: ++calls });
    await first('public-film', 100, load);
    clock = 50;
    assert.deepEqual(await second('public-film', 100, load), { id: 1 });
    assert.equal(calls, 1);
    clock = 100;
    assert.deepEqual(await second('public-film', 100, load), { id: 2 });
});

test('failed upstream calls retry and Redis failures fall back to the API', async () => {
    const cached = createCache({ client: () => ({
        get: async () => { throw new Error('offline'); },
    }) });
    await assert.rejects(cached('film', 100, async () => { throw new Error('upstream'); }), /upstream/);
    assert.equal(await cached('film', 100, async () => 'recovered'), 'recovered');
    const writeFailure = createCache({ client: () => ({
        get: async () => null,
        set: async () => { throw new Error('offline'); },
    }) });
    assert.equal(await writeFailure('film', 100, async () => 'ok'), 'ok');
});
