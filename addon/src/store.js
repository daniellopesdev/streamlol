const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const TOKEN_RE = /^[a-f0-9]{24}$/;
const queues = new Map();

let redisClient = null;

function emptyLibrary() {
    return {
        films: {},
        status: {},
        reviews: {},
        lists: [],
        views: [],
        settings: { country: 'US', hideViewed: true },
    };
}

function assertToken(token) {
    if (!TOKEN_RE.test(token)) {
        const error = new Error('Invalid token');
        error.status = 404;
        throw error;
    }
}

function fileFor(token) {
    assertToken(token);
    return path.join(DATA_DIR, `${token}.json`);
}

function normalize(parsed) {
    return {
        ...emptyLibrary(),
        ...parsed,
        films: parsed.films || {},
        status: parsed.status || {},
        reviews: parsed.reviews || {},
        lists: parsed.lists || [],
        views: parsed.views || [],
        settings: { ...emptyLibrary().settings, ...(parsed.settings || {}) },
    };
}

function redisCredentials() {
    const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
    const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
    if (!url || !token) return null;
    return { url, token };
}

function redisEnabled() {
    return Boolean(redisCredentials());
}

function onVercel() {
    return Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
}

function assertWritableStorage() {
    if (redisEnabled()) return;
    if (!onVercel()) return;
    const error = new Error(
        'Vercel has no writable disk. Add Upstash Redis to this project '
        + '(UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN), then redeploy. '
        + 'See addon/DEPLOY.md'
    );
    error.status = 503;
    error.code = 'storage_missing';
    throw error;
}

function redis() {
    const credentials = redisCredentials();
    if (!credentials) return null;
    if (!redisClient) {
        const { Redis } = require('@upstash/redis');
        redisClient = new Redis(credentials);
    }
    return redisClient;
}

function redisKey(token) {
    return `streamlol:library:${token}`;
}

async function load(token, { required = false } = {}) {
    assertToken(token);
    function missing() {
        if (required) throw Object.assign(new Error('Library not found'), { status: 404 });
        return emptyLibrary();
    }
    const client = redis();
    if (client) {
        const parsed = await client.get(redisKey(token));
        if (!parsed) return missing();
        return normalize(typeof parsed === 'string' ? JSON.parse(parsed) : parsed);
    }
    assertWritableStorage();
    const file = fileFor(token);
    if (!fs.existsSync(file)) return missing();
    return normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
}

async function save(token, library) {
    assertToken(token);
    const client = redis();
    if (client) {
        await client.set(redisKey(token), library);
        return;
    }
    assertWritableStorage();
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const file = fileFor(token);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(library, null, 2));
    fs.renameSync(tmp, file);
}

function update(token, mutator) {
    const prev = queues.get(token) || Promise.resolve();
    const next = prev.then(async () => {
        const library = await load(token);
        const result = await mutator(library);
        await save(token, library);
        return result === undefined ? library : result;
    });
    const settled = next.then(() => {}, () => {});
    queues.set(token, settled);
    settled.then(() => {
        if (queues.get(token) === settled) queues.delete(token);
    });
    return next;
}

function createToken() {
    return crypto.randomBytes(12).toString('hex');
}

function createId() {
    return crypto.randomBytes(4).toString('hex');
}

function storageMode() {
    return redisEnabled() ? 'redis' : (onVercel() ? 'missing' : 'file');
}

module.exports = {
    DATA_DIR,
    TOKEN_RE,
    emptyLibrary,
    assertToken,
    load,
    save,
    update,
    createToken,
    createId,
    storageMode,
    redisEnabled,
    redis,
};
