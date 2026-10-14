const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const TOKEN_RE = /^[a-f0-9]{24}$/;
const queues = new Map();

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

function load(token) {
    const file = fileFor(token);
    if (!fs.existsSync(file)) return emptyLibrary();
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
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

function save(token, library) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const file = fileFor(token);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(library, null, 2));
    fs.renameSync(tmp, file);
}

function update(token, mutator) {
    const prev = queues.get(token) || Promise.resolve();
    const next = prev.then(() => {
        const library = load(token);
        const result = mutator(library);
        save(token, library);
        return result === undefined ? library : result;
    });
    queues.set(token, next.then(() => {}, () => {}));
    return next;
}

function createToken() {
    return crypto.randomBytes(12).toString('hex');
}

function createId() {
    return crypto.randomBytes(4).toString('hex');
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
};
