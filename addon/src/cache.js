const { createHash } = require('node:crypto');
const { redis } = require('./store');

const HOUR = 60 * 60 * 1000;

function createCache({ client = redis, now = Date.now, maxEntries = 2000 } = {}) {
    const entries = new Map();
    const pending = new Map();

    function remember(key, entry) {
        entries.delete(key);
        entries.set(key, entry);
        while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
    }

    return async function cached(key, ttl, load) {
        const hit = entries.get(key);
        if (hit && hit.expires > now()) return structuredClone(hit.value);
        entries.delete(key);
        if (!pending.has(key)) {
            const task = (async () => {
                const redisKey = `streamlol:metadata:v1:${createHash('sha256').update(key).digest('hex')}`;
                let remote;
                try {
                    remote = client();
                    const saved = remote && await remote.get(redisKey);
                    if (saved && saved.expires > now()) {
                        remember(key, saved);
                        return saved.value;
                    }
                } catch {
                    // Metadata caching must not make the upstream API unavailable.
                    remote = null;
                }
                const value = await load();
                const entry = { value, expires: now() + ttl };
                remember(key, entry);
                if (remote) {
                    try {
                        await remote.set(redisKey, entry, { px: ttl });
                    } catch {
                        // Keep serving the local cache if Redis is unavailable.
                    }
                }
                return value;
            })();
            pending.set(key, task);
            task.then(() => pending.delete(key), () => pending.delete(key));
        }
        // Callers may annotate or sort payloads; never mutate the cached copy.
        return structuredClone(await pending.get(key));
    };
}

module.exports = { cached: createCache(), createCache, HOUR };
