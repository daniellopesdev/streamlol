const { load, update } = require('./store');
const { upsertFilm } = require('./library');
const { cinemetaMeta } = require('./cinemeta');
const { mapPool } = require('./discover');

const API = 'https://api.strem.io/api';
const ADDON_ID = 'com.streamlol.shelves';
const IMDB_RE = /^tt\d{4,}$/;
const AUTO_SYNC_MS = 15 * 60 * 1000;
const ENRICH_LIMIT = 400;
const inflight = new Map();

function httpError(message, status, code) {
    const error = new Error(message);
    error.status = status;
    if (code) error.code = code;
    return error;
}

async function call(method, body) {
    let response;
    try {
        response = await fetch(`${API}/${method}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
    } catch {
        throw httpError('Could not reach Stremio. Try again in a moment.', 502);
    }
    const payload = await response.json().catch(() => ({}));
    if (payload.error) {
        const expired = payload.error.code === 1;
        throw httpError(
            expired ? 'Stremio session expired. Connect your account again.' : (payload.error.message || 'Stremio rejected the request'),
            expired ? 401 : 400,
            expired ? 'stremio_expired' : 'stremio_error'
        );
    }
    if (!response.ok) throw httpError(`Stremio request failed (${response.status})`, 502);
    return payload.result;
}

async function connect(input = {}) {
    const authKey = String(input.authKey || '').trim().replace(/^"|"$/g, '');
    if (authKey) {
        const user = await call('getUser', { type: 'GetUser', authKey }).catch((error) => {
            throw error.code === 'stremio_expired'
                ? httpError('Stremio did not accept that auth key. Copy it again from web.stremio.com.', 400, 'stremio_error')
                : error;
        });
        return { authKey, email: (user && user.email) || '' };
    }
    const email = String(input.email || '').trim();
    const password = String(input.password || '');
    if (!email || !password) throw httpError('Enter your Stremio email and password, or paste an auth key.', 400);
    const result = await call('login', { type: 'Login', email, password, facebook: false });
    if (!result || !result.authKey) throw httpError('Stremio login failed', 400);
    return { authKey: result.authKey, email: (result.user && result.user.email) || email };
}

function stremioItems(raw) {
    return (raw || [])
        .filter((item) => item && IMDB_RE.test(item._id || '') && (item.type === 'movie' || item.type === 'series'))
        .map((item) => {
            const state = item.state || {};
            const watched = (state.timesWatched || 0) > 0 || (state.flaggedWatched || 0) > 0;
            const inLibrary = !item.removed && !item.temp;
            return {
                imdbId: item._id,
                type: item.type,
                title: item.name || item._id,
                poster: item.poster || null,
                watched,
                inLibrary,
                addedAt: Date.parse(item._ctime) || null,
                watchedAt: watched ? (Date.parse(state.lastWatched) || Date.parse(item._mtime) || null) : null,
            };
        })
        .filter((item) => item.inLibrary || item.watched);
}

function posterFor(item, meta) {
    const candidates = [meta && meta.poster, item.poster];
    const https = candidates.find((value) => typeof value === 'string' && value.startsWith('https://'));
    return https || `https://images.metahub.space/poster/medium/${item.imdbId}/img`;
}

// One-way, additive: Stremio adds titles and upgrades them to viewed. Titles it imported
// and you never touched (no review, no list) leave again when they leave Stremio.
function mergeStremio(library, items, metas = new Map()) {
    const result = { added: 0, viewed: 0, removed: 0, total: items.length };
    const present = new Set(items.map((item) => item.imdbId));
    items.forEach((item) => {
        const existing = library.films[item.imdbId];
        const meta = metas.get(item.imdbId) || null;
        if (!existing) {
            const film = upsertFilm(library, {
                imdbId: item.imdbId,
                type: item.type,
                title: (meta && meta.name) || item.title,
                year: meta ? String(meta.releaseInfo || meta.year || '').slice(0, 4) : '',
                poster: posterFor(item, meta),
                genres: (meta && (meta.genres || meta.genre)) || [],
                imdbRating: (meta && meta.imdbRating) || null,
                description: (meta && meta.description) || '',
            }, item.watched ? 'viewed' : 'library');
            film.origin = 'stremio';
            if (item.addedAt) film.addedAt = item.addedAt;
            if (item.watched && item.watchedAt) film.viewedAt = item.watchedAt;
            result.added += 1;
            if (item.watched) result.viewed += 1;
            return;
        }
        if (item.watched && library.status[item.imdbId] !== 'viewed') {
            library.status[item.imdbId] = 'viewed';
            existing.viewedAt = existing.viewedAt || item.watchedAt || Date.now();
            result.viewed += 1;
        }
    });
    const listed = new Set(library.lists.flatMap((list) => list.filmIds));
    Object.values(library.films).forEach((film) => {
        if (film.origin !== 'stremio' || present.has(film.imdbId)) return;
        if (library.status[film.imdbId] !== 'library' || library.reviews[film.imdbId] || listed.has(film.imdbId)) return;
        delete library.films[film.imdbId];
        delete library.status[film.imdbId];
        result.removed += 1;
    });
    return result;
}

async function runSync(token) {
    const library = await load(token);
    const link = library.stremio;
    if (!link || !link.authKey) throw httpError('Stremio is not connected', 400, 'stremio_missing');
    let raw;
    try {
        raw = await call('datastoreGet', { authKey: link.authKey, collection: 'libraryItem', ids: [], all: true });
    } catch (error) {
        if (error.code === 'stremio_expired') {
            await update(token, (draft) => {
                if (draft.stremio) draft.stremio.error = 'expired';
            });
        }
        throw error;
    }
    const items = stremioItems(raw);
    const fresh = items.filter((item) => !library.films[item.imdbId]).slice(0, ENRICH_LIMIT);
    const metas = new Map();
    await mapPool(fresh, 8, async (item) => {
        const meta = await cinemetaMeta(item.type, item.imdbId);
        if (meta) metas.set(item.imdbId, meta);
    });
    return update(token, (draft) => {
        if (!draft.stremio || draft.stremio.authKey !== link.authKey) return { added: 0, viewed: 0, removed: 0, total: 0 };
        const result = mergeStremio(draft, items, metas);
        draft.stremio.lastSync = Date.now();
        draft.stremio.lastResult = result;
        delete draft.stremio.error;
        return result;
    });
}

function sync(token) {
    if (!inflight.has(token)) {
        const pending = runSync(token).finally(() => inflight.delete(token));
        inflight.set(token, pending);
    }
    return inflight.get(token);
}

function isStale(library, maxAge = AUTO_SYNC_MS) {
    const link = library && library.stremio;
    if (!link || !link.authKey || link.error === 'expired') return false;
    return !link.lastSync || Date.now() - link.lastSync > maxAge;
}

// Used by catalog requests (Stremio Board/TV): sync if stale, but never block longer than `waitMs`.
async function freshLibrary(token, library, waitMs = 4000) {
    if (!isStale(library)) return library;
    const pending = sync(token).then(() => load(token)).catch(() => library);
    const timeout = new Promise((resolve) => setTimeout(() => resolve(library), waitMs));
    return Promise.race([pending, timeout]);
}

function publicStatus(link) {
    if (!link || !link.authKey) return null;
    return {
        email: link.email || '',
        lastSync: link.lastSync || null,
        lastResult: link.lastResult || null,
        error: link.error || null,
        addon: link.addon || null,
    };
}

function transportOf(addon) {
    return String((addon && (addon.transportUrl || addon.transport_url || addon.url)) || '');
}

function findShelvesAddon(addons, manifestUrl) {
    const wanted = String(manifestUrl || '').replace(/\/$/, '');
    const list = Array.isArray(addons) ? addons : [];
    const exact = list.find((addon) => {
        const url = transportOf(addon).replace(/\/$/, '');
        return wanted && (url === wanted || url.startsWith(`${wanted}?`));
    });
    if (exact) return exact;
    return list.find((addon) => {
        const id = addon.manifest && addon.manifest.id;
        return id === ADDON_ID || transportOf(addon).includes('/manifest.json');
    }) || null;
}

async function addonCollection(authKey, { addFromURL } = {}) {
    const body = { type: 'AddonCollectionGet', authKey, update: true };
    if (addFromURL && addFromURL.length) body.addFromURL = addFromURL;
    const result = await call('addonCollectionGet', body);
    return (result && result.addons) || result || [];
}

function normalizeManifestUrl(url) {
    return String(url || '').replace(/^stremio:\/\//, 'https://').replace(/\/$/, '');
}

function isThisLibraryAddon(addon, manifestUrl) {
    const wanted = normalizeManifestUrl(manifestUrl);
    const url = transportOf(addon).replace(/\/$/, '');
    if (!wanted || !url) return false;
    return url === wanted || url.startsWith(`${wanted}?`);
}

// Read-only: is this library's Shelves URL already on the account?
async function probeAddon(authKey, manifestUrl) {
    if (!authKey || !manifestUrl) return { installed: false };
    const httpsUrl = normalizeManifestUrl(manifestUrl);
    const addons = await addonCollection(authKey);
    const match = addons.find((addon) => isThisLibraryAddon(addon, httpsUrl));
    return {
        installed: Boolean(match),
        wasInstalled: Boolean(match),
        transportUrl: match ? transportOf(match) : null,
    };
}

// Install only when missing. If already installed, do not addFromURL again
// (that can create a duplicate addon) — the live manifest URL already updates Board rows.
async function syncAddon(authKey, manifestUrl) {
    if (!authKey || !manifestUrl) return { installed: false, updated: false, wasInstalled: false };
    const httpsUrl = normalizeManifestUrl(manifestUrl);
    const probed = await probeAddon(authKey, httpsUrl);
    if (probed.installed) {
        return { installed: true, updated: true, wasInstalled: true, transportUrl: probed.transportUrl || httpsUrl };
    }
    const addons = await addonCollection(authKey, { addFromURL: [httpsUrl] });
    const match = addons.find((addon) => isThisLibraryAddon(addon, httpsUrl));
    return {
        installed: Boolean(match),
        updated: Boolean(match),
        wasInstalled: false,
        transportUrl: match ? (transportOf(match) || httpsUrl) : null,
    };
}

async function refreshAddonStatus(token, manifestUrl) {
    const library = await load(token);
    const link = library.stremio;
    if (!link || !link.authKey || !manifestUrl) return null;
    try {
        const addon = await probeAddon(link.authKey, manifestUrl);
        await update(token, (draft) => {
            if (draft.stremio) draft.stremio.addon = {
                installed: Boolean(addon.installed),
                transportUrl: addon.transportUrl || null,
            };
        });
        return addon;
    } catch {
        return link.addon || null;
    }
}

module.exports = {
    AUTO_SYNC_MS,
    connect,
    stremioItems,
    mergeStremio,
    sync,
    isStale,
    freshLibrary,
    publicStatus,
    addonCollection,
    findShelvesAddon,
    probeAddon,
    syncAddon,
    refreshAddonStatus,
};
