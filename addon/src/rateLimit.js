const { createHash } = require('node:crypto');
const { redis } = require('./store');

const COUNT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('PTTL', KEYS[1])}
`;

function createLimiter({ client = redis, now = Date.now } = {}) {
    // ponytail: local counters cover one process; configured Redis coordinates server instances.
    const windows = new Map();
    return async function limit(req, res, bucket, maximum, windowMs) {
        const key = `streamlol:limits:${bucket}:${createHash('sha256').update(req.ip || 'unknown').digest('hex')}`;
        let count;
        let remaining;
        try {
            const remote = client();
            if (remote) {
                [count, remaining] = await remote.eval(COUNT, [key], [windowMs]);
            } else {
                const time = now();
                for (const [id, entry] of windows) if (entry.expires <= time) windows.delete(id);
                if (!windows.has(key)) {
                    if (windows.size >= 10000) throw new Error('Limiter capacity reached');
                    windows.set(key, { count: 0, expires: time + windowMs });
                }
                const entry = windows.get(key);
                count = ++entry.count;
                remaining = entry.expires - time;
            }
        } catch {
            throw Object.assign(new Error('Request protection is temporarily unavailable. Try again shortly.'), { status: 503 });
        }
        if (count > maximum) {
            res.setHeader('Retry-After', String(Math.max(1, Math.ceil(remaining / 1000))));
            throw Object.assign(new Error('Too many attempts. Try again later.'), { status: 429 });
        }
    };
}

module.exports = { createLimiter };
