const { createHash } = require('node:crypto');
const { redis } = require('./store');
const { AsyncLocalStorage } = require('node:async_hooks');
const { performance } = require('node:perf_hooks');

const HOUR = 60 * 60 * 1000;
const measurements = new AsyncLocalStorage();

function record(event) {
    const stats = measurements.getStore();
    if (stats) stats[event] = (stats[event] || 0) + 1;
}

async function measureCache(load) {
    const stats = { memoryHits: 0, redisHits: 0, misses: 0, coalesced: 0, writes: 0, errors: 0 };
    const start = performance.now();
    const value = await measurements.run(stats, load);
    return { value, stats, durationMs: Math.round(performance.now() - start) };
}

function createCache({ client = redis, now = Date.now, maxEntries = 2000 } = {}) {
    const entries = new Map();
    const pending = new Map();

    function remember(key, entry) {
        entries.delete(key);
        entries.set(key, entry);
        while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    }

    return async function cached(key, ttl, load, { cacheIf = () => true } = {}) {
        const hit = entries.get(key);
        if (hit && hit.expires > now()) {
            record('memoryHits');
            return structuredClone(hit.value);
        }
        entries.delete(key);
        if (!pending.has(key)) {
            const task = (async () => {
                const redisKey = `streamlol:metadata:v1:${createHash('sha256').update(key).digest('hex')}`;
                let remote;
                try {
                    remote = client();
                    const saved = remote && await remote.get(redisKey);
                    if (saved && saved.expires > now()) {
                        record('redisHits');
                        remember(key, saved);
                        return saved.value;
                    }
                } catch {
                    record('errors');
                    // Metadata caching must not make the upstream API unavailable.
                    remote = null;
                }
                record('misses');
                const value = await load();
                if (!cacheIf(value)) return value;
                const entry = { value, expires: now() + ttl };
                remember(key, entry);
                if (remote) {
                    try {
                        await remote.set(redisKey, entry, { px: ttl });
                        record('writes');
                    } catch {
                        record('errors');
                        // Keep serving the local cache if Redis is unavailable.
                    }
                }
                return value;
            })();
            pending.set(key, task);
            task.then(() => pending.delete(key), () => pending.delete(key));
        } else {
            record('coalesced');
        }
        // Callers may annotate or sort payloads; never mutate the cached copy.
        return structuredClone(await pending.get(key));
    };
}

module.exports = { cached: createCache(), createCache, HOUR, measureCache };
