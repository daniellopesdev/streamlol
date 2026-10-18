require('dotenv').config();

const path = require('path');
const express = require('express');
const { toMeta } = require('./catalog');
const { discover, reference } = require('./discover');
const { credentialFor, credentialSource, verifyCredential } = require('./tmdb');
const { details, suggestions, personFilms } = require('./details');
const { searchScopes } = require('./scopes');
const stremio = require('./stremio');
const { createInterface } = require('./manifest');
const { configurePage } = require('./configurePage');
const { appPage } = require('./appPage');
const { TOKEN_RE, load, update, createToken, storageMode } = require('./store');
const actions = require('./library');
const { createLimiter } = require('./rateLimit');

function readToken(raw) {
    if (TOKEN_RE.test(raw)) return raw;
    try {
        const json = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
        if (json && TOKEN_RE.test(json.token)) return json.token;
    } catch {
        return null;
    }
    return null;
}

const TOKEN_KEY = 'streamlol_token';
const WELCOME = path.join(__dirname, '..', 'public', 'shelves', 'welcome.html');
const ONE_YEAR_S = 365 * 24 * 60 * 60;

const STREMIO_KEY = 'streamlol_stremio';

function readCookie(req, name) {
    const header = req.get('cookie') || '';
    const match = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
    try {
        return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
    } catch {
        return '';
    }
}

function secureFlag(req) {
    return req.secure ? '; Secure' : '';
}

function rememberedToken(req) {
    const value = readCookie(req, TOKEN_KEY);
    return TOKEN_RE.test(value) ? value : null;
}

function rememberToken(req, res, token) {
    res.append('Set-Cookie', `${TOKEN_KEY}=${token}; Max-Age=${ONE_YEAR_S}; Path=/; HttpOnly; SameSite=Lax${secureFlag(req)}`);
}

// The Stremio session key stays on the device that signed in (HttpOnly), so other
// libraries on that device can connect without asking for the password again.
function deviceStremio(req) {
    try {
        const json = JSON.parse(Buffer.from(readCookie(req, STREMIO_KEY), 'base64url').toString('utf8'));
        return json && typeof json.authKey === 'string' && json.authKey ? { authKey: json.authKey, email: String(json.email || '') } : null;
    } catch {
        return null;
    }
}

function rememberStremio(req, res, link) {
    const value = Buffer.from(JSON.stringify({ authKey: link.authKey, email: link.email })).toString('base64url');
    res.append('Set-Cookie', `${STREMIO_KEY}=${value}; Max-Age=${ONE_YEAR_S}; Path=/; HttpOnly; SameSite=Lax${secureFlag(req)}`);
}

function forgetStremio(req, res) {
    res.append('Set-Cookie', `${STREMIO_KEY}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secureFlag(req)}`);
}

function asyncRoute(handler) {
    return (req, res, next) => {
        Promise.resolve().then(() => handler(req, res, next)).catch(next);
    };
}

function publicLibrary(library) {
    const { tmdbToken, ...settings } = library.settings;
    return {
        ...library,
        settings: { ...settings, tmdb: credentialSource(library) },
        stremio: stremio.publicStatus(library.stremio),
    };
}

function publicOrigin(req) {
    try {
        const url = new URL(`${req.secure ? 'https' : 'http'}://${req.get('host')}`);
        if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid host');
        return url.origin;
    } catch {
        throw Object.assign(new Error('Invalid request host'), { status: 400 });
    }
}

function publicUrl(req, token, suffix) {
    return `${publicOrigin(req)}/${token}/${suffix}`;
}

function createApp() {
    const app = express();
    const limit = createLimiter();
    app.disable('x-powered-by');
    // Trust the nearest reverse proxy, rather than arbitrary client-supplied proxy hops.
    app.set('trust proxy', 1);
    app.use((req, res, next) => {
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Content-Security-Policy', "base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'");
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'OPTIONS') {
            res.sendStatus(204);
            return;
        }
        next();
    });
    app.use(express.json({ limit: '1mb' }));

    app.use('/shelves', express.static(path.join(__dirname, '..', 'public', 'shelves'), {
        fallthrough: true,
        setHeaders(res) {
            res.setHeader('Cache-Control', 'public, max-age=300');
        },
    }));

    app.get('/', (req, res) => {
        res.sendFile(WELCOME);
    });

    app.get('/health', (req, res) => {
        const storage = storageMode();
        res.status(storage === 'missing' ? 503 : 200).json({
            ok: storage !== 'missing',
            storage,
            hint: storage === 'missing'
                ? 'Add Upstash Redis env vars UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_*), then redeploy.'
                : undefined,
        });
    });

    app.get('/configure', asyncRoute(async (req, res) => {
        const saved = req.query.new ? null : rememberedToken(req);
        if (saved) {
            res.redirect(`/${saved}/`);
            return;
        }
        await limit(req, res, 'create', 20, 60 * 60 * 1000);
        const token = createToken();
        await update(token, () => {});
        res.redirect(`/${token}/`);
    }));

    function sendApp(req, res, token) {
        const origin = publicOrigin(req);
        const manifestUrl = publicUrl(req, token, 'manifest.json');
        const installUrl = manifestUrl.replace(/^https?:\/\//, 'stremio://');
        return load(token, { required: true }).then((library) => {
            rememberToken(req, res, token);
            res.type('html').send(appPage({
                token,
                origin,
                manifestUrl,
                installUrl,
                tmdb: credentialSource(library),
            }));
        });
    }

    app.get('/:config/configure', asyncRoute(async (req, res) => {
        const token = readToken(req.params.config);
        if (!token) {
            res.redirect('/configure');
            return;
        }
        const manifestUrl = publicUrl(req, token, 'manifest.json');
        const installUrl = manifestUrl.replace(/^https?:\/\//, 'stremio://');
        const library = await load(token, { required: true });
        res.type('html').send(configurePage({
            manifestUrl,
            installUrl,
            token,
            tmdb: credentialSource(library),
            appUrl: publicUrl(req, token, '').replace(/\/$/, '') + '/',
        }));
    }));

    app.get('/:config/', asyncRoute(async (req, res) => {
        const token = readToken(req.params.config);
        if (!token) {
            res.redirect('/configure');
            return;
        }
        await sendApp(req, res, token);
    }));

    app.get('/:config', (req, res, next) => {
        const token = readToken(req.params.config);
        if (!token) {
            next();
            return;
        }
        // Only bare library URLs — leave manifest/catalog/api alone.
        if (req.path !== `/${req.params.config}` && req.path !== `/${req.params.config}/`) {
            next();
            return;
        }
        sendApp(req, res, token).catch(next);
    });

    app.get('/:config/manifest.json', asyncRoute(async (req, res) => {
        const token = readToken(req.params.config);
        if (!token) {
            res.status(404).json({ err: 'Invalid token' });
            return;
        }
        const library = await load(token, { required: true });
        const iface = createInterface(library, resolveView);
        res.json(iface.manifest);
    }));

    app.get('/:config/catalog/:type/:id.json', catalogRoute);
    app.get('/:config/catalog/:type/:id/:extra.json', catalogRoute);

    app.use('/api/:token', asyncRoute(async (req, res, next) => {
        req.library = await load(req.params.token, { required: true });
        next();
    }));

    app.delete('/api/:token/device', (req, res) => {
        res.append('Set-Cookie', `${TOKEN_KEY}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secureFlag(req)}`);
        forgetStremio(req, res);
        res.json({ ok: true });
    });

    app.get('/api/:token', asyncRoute(async (req, res) => {
        res.json(publicLibrary(req.library));
    }));

    app.get('/api/:token/reference', asyncRoute(async (req, res) => {
        const library = req.library;
        const country = /^[A-Z]{2}$/.test(req.query.country || '') ? req.query.country : library.settings.country;
        res.json(await reference(credentialFor(library), country, req.query.type));
    }));

    app.get('/api/:token/details/:type/:imdbId', asyncRoute(async (req, res) => {
        res.json(await details(req.library, req.params.type, req.params.imdbId));
    }));

    app.get('/api/:token/suggestions/:type/:imdbId', asyncRoute(async (req, res) => {
        res.json(await suggestions(req.library, req.params.type, req.params.imdbId));
    }));

    app.get('/api/:token/person/:personId', asyncRoute(async (req, res) => {
        if (!/^\d+$/.test(req.params.personId)) {
            res.status(400).json({ err: 'Invalid person id' });
            return;
        }
        const library = req.library;
        res.json(await personFilms(library, req.query.type, req.params.personId, req.query.role, String(req.query.name || '').slice(0, 120), req.query.exclude));
    }));

    app.get('/api/:token/search', asyncRoute(async (req, res) => {
        const library = req.library;
        const credential = credentialFor(library);
        if (!credential) {
            res.status(412).json({ err: 'Search by people and collections needs a TMDB token.', code: 'tmdb_missing' });
            return;
        }
        res.json(await searchScopes(credential, req.query.q, req.query.type));
    }));

    app.get('/api/:token/stremio/device', asyncRoute(async (req, res) => {
        const saved = deviceStremio(req);
        if (!saved) {
            res.json({ email: null, saved: false, addon: null });
            return;
        }
        const manifestUrl = publicUrl(req, req.params.token, 'manifest.json');
        let addon = null;
        try {
            addon = await stremio.probeAddon(saved.authKey, manifestUrl);
        } catch (error) {
            if (error.code === 'stremio_expired') {
                forgetStremio(req, res);
                res.json({ email: null, saved: false, addon: null, expired: true });
                return;
            }
        }
        res.json({
            email: saved.email || null,
            saved: true,
            addon: addon ? { installed: Boolean(addon.installed), transportUrl: addon.transportUrl || null } : null,
        });
    }));

    app.delete('/api/:token/stremio/device', (req, res) => {
        forgetStremio(req, res);
        res.json({ ok: true });
    });

    async function attachAddon(token, req, authKey) {
        const manifestUrl = publicUrl(req, token, 'manifest.json');
        try {
            const addon = await stremio.syncAddon(authKey, manifestUrl);
            await update(token, (draft) => {
                if (draft.stremio) draft.stremio.addon = {
                    installed: Boolean(addon.installed),
                    transportUrl: addon.transportUrl || null,
                };
            });
            return addon;
        } catch {
            return null;
        }
    }

    app.post('/api/:token/stremio', asyncRoute(async (req, res) => {
        await limit(req, res, 'stremio-login', 10, 15 * 60 * 1000);
        const body = req.body || {};
        let link;
        if (body.device) {
            const saved = deviceStremio(req);
            if (!saved) throw Object.assign(new Error('No saved Stremio session on this device. Sign in again.'), { status: 400 });
            link = await stremio.connect({ authKey: saved.authKey }).catch((error) => {
                if (error.status >= 500) throw error;
                forgetStremio(req, res);
                throw Object.assign(new Error('Your saved Stremio session expired. Sign in again.'), { status: 401, cause: error });
            });
        } else {
            link = await stremio.connect(body);
        }
        rememberStremio(req, res, link);
        await update(req.params.token, (draft) => {
            draft.stremio = { authKey: link.authKey, email: link.email, addon: draft.stremio && draft.stremio.addon };
        });
        const result = await stremio.sync(req.params.token);
        const addon = await attachAddon(req.params.token, req, link.authKey);
        res.json({ result, addon, library: publicLibrary(await load(req.params.token)) });
    }));

    app.post('/api/:token/stremio/sync', asyncRoute(async (req, res) => {
        const result = await stremio.sync(req.params.token);
        const library = await load(req.params.token);
        let addon = null;
        if (library.stremio && library.stremio.authKey) {
            addon = await attachAddon(req.params.token, req, library.stremio.authKey);
        }
        res.json({ result, addon, library: publicLibrary(await load(req.params.token)) });
    }));

    // Push the current Shelves manifest into Stremio (install if missing, refresh if present).
    app.post('/api/:token/stremio/addon', asyncRoute(async (req, res) => {
        const library = req.library;
        if (!library.stremio || !library.stremio.authKey) {
            const error = new Error('Connect Stremio first');
            error.status = 400;
            throw error;
        }
        const addon = await stremio.syncAddon(library.stremio.authKey, publicUrl(req, req.params.token, 'manifest.json'));
        await update(req.params.token, (draft) => {
            if (draft.stremio) draft.stremio.addon = {
                installed: Boolean(addon.installed),
                transportUrl: addon.transportUrl || null,
            };
        });
        res.json({ addon, library: publicLibrary(await load(req.params.token)) });
    }));

    app.delete('/api/:token/stremio', asyncRoute(async (req, res) => {
        const library = await update(req.params.token, (draft) => {
            delete draft.stremio;
        });
        res.json(publicLibrary(library));
    }));

    app.put('/api/:token/tmdb', asyncRoute(async (req, res) => {
        const credential = await verifyCredential(req.body?.token);
        const library = await update(req.params.token, (draft) => {
            draft.settings.tmdbToken = credential;
            return draft;
        });
        res.json(publicLibrary(library).settings);
    }));

    app.delete('/api/:token/tmdb', asyncRoute(async (req, res) => {
        const library = await update(req.params.token, (draft) => {
            delete draft.settings.tmdbToken;
            return draft;
        });
        res.json(publicLibrary(library).settings);
    }));

    app.get('/api/:token/discover', asyncRoute(async (req, res) => {
        if (res.destroyed) return;
        const controller = new AbortController();
        const cancel = () => { if (!res.writableEnded) controller.abort(); };
        res.on('close', cancel);
        try {
            const library = req.library;
            const filters = actions.cleanFilters({
                ...req.query,
                hideViewed: req.query.hideViewed === undefined ? library.settings.hideViewed : req.query.hideViewed !== 'false',
                country: req.query.country || library.settings.country,
            });
            const result = await discover(library, filters, req.query.cursor || null, { signal: controller.signal });
            if (!res.destroyed) res.json(result);
        } finally {
            res.off('close', cancel);
        }
    }));

    app.put('/api/:token/settings', asyncRoute(async (req, res) => {
        const library = await update(req.params.token, (draft) => {
            actions.updateSettings(draft, req.body || {});
            return draft;
        });
        res.json(publicLibrary(library).settings);
    }));

    app.post('/api/:token/films', asyncRoute(async (req, res) => {
        const film = await update(req.params.token, (library) => actions.upsertFilm(library, req.body || {}, req.body?.status));
        res.json(film);
    }));

    app.post('/api/:token/films/:imdbId/status', asyncRoute(async (req, res) => {
        const film = await update(req.params.token, (library) => actions.setStatus(library, req.params.imdbId, req.body?.status));
        res.json(film);
    }));

    app.post('/api/:token/films/:imdbId/viewed-at', asyncRoute(async (req, res) => {
        const film = await update(req.params.token, (library) => actions.setViewedAt(library, req.params.imdbId, req.body?.viewedAt));
        res.json(film);
    }));

    app.post('/api/:token/films/:imdbId/review', asyncRoute(async (req, res) => {
        const review = await update(req.params.token, (library) => actions.setReview(library, req.params.imdbId, req.body || {}));
        res.json(review);
    }));

    app.delete('/api/:token/films/:imdbId/review', asyncRoute(async (req, res) => {
        await update(req.params.token, (library) => actions.clearReview(library, req.params.imdbId));
        res.json({ ok: true });
    }));

    app.delete('/api/:token/films/:imdbId', asyncRoute(async (req, res) => {
        await update(req.params.token, (library) => actions.removeFilm(library, req.params.imdbId));
        res.json({ ok: true });
    }));

    app.post('/api/:token/lists', asyncRoute(async (req, res) => {
        const list = await update(req.params.token, (library) => actions.addList(library, req.body?.name));
        res.json(list);
    }));

    app.post('/api/:token/lists/reorder', asyncRoute(async (req, res) => {
        await update(req.params.token, (library) => actions.reorderLists(library, req.body?.ids || []));
        res.json({ ok: true });
    }));

    app.patch('/api/:token/lists/:id', asyncRoute(async (req, res) => {
        const list = await update(req.params.token, (library) => actions.renameList(library, req.params.id, req.body?.name));
        res.json(list);
    }));

    app.delete('/api/:token/lists/:id', asyncRoute(async (req, res) => {
        await update(req.params.token, (library) => actions.deleteList(library, req.params.id));
        res.json({ ok: true });
    }));

    app.post('/api/:token/lists/:id/films', asyncRoute(async (req, res) => {
        const list = await update(req.params.token, (library) => {
            if (req.body?.film) actions.upsertFilm(library, req.body.film, req.body.film.status);
            return actions.addFilmToList(library, req.params.id, req.body?.imdbId || req.body?.film?.imdbId);
        });
        res.json(list);
    }));

    app.delete('/api/:token/lists/:id/films/:imdbId', asyncRoute(async (req, res) => {
        const list = await update(req.params.token, (library) => actions.removeFilmFromList(library, req.params.id, req.params.imdbId));
        res.json(list);
    }));

    app.post('/api/:token/views', asyncRoute(async (req, res) => {
        const view = await update(req.params.token, (library) => actions.addView(library, req.body?.name, req.body?.filters));
        res.json(view);
    }));

    app.delete('/api/:token/views/:id', asyncRoute(async (req, res) => {
        await update(req.params.token, (library) => actions.deleteView(library, req.params.id));
        res.json({ ok: true });
    }));

    app.use((error, req, res, next) => {
        if (res.destroyed) return;
        if (res.headersSent) {
            next(error);
            return;
        }
        const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
        const message = error.type === 'entity.parse.failed' ? 'Invalid JSON body'
            : status === 500 ? 'Internal server error' : (error.message || 'Request failed');
        res.status(status).json({ err: message, code: status === 500 ? undefined : error.code });
    });

    return app;
}

const viewCursors = new Map();

async function resolveView(library, view, skip) {
    const key = (offset) => `${view.id}:${JSON.stringify(view.filters)}:${offset}`;
    const cursor = skip ? viewCursors.get(key(skip)) : null;
    if (skip && !cursor) return [];
    try {
        const found = await discover(library, view.filters || {}, cursor);
        if (found.nextCursor) {
            if (viewCursors.size > 5000) viewCursors.clear();
            viewCursors.set(key(skip + found.results.length), found.nextCursor);
        }
        return found.results.map((film) => toMeta(film));
    } catch {
        return [];
    }
}

function parseExtra(segment) {
    if (!segment) return {};
    const extra = {};
    decodeURIComponent(segment).split('&').forEach((part) => {
        const index = part.indexOf('=');
        if (index === -1) return;
        extra[decodeURIComponent(part.slice(0, index))] = decodeURIComponent(part.slice(index + 1));
    });
    return extra;
}

function catalogRoute(req, res, next) {
    const token = readToken(req.params.config);
    if (!token) {
        res.status(404).json({ err: 'Invalid token' });
        return;
    }
    load(token, { required: true })
        .then((library) => stremio.freshLibrary(token, library))
        .then((library) => {
            const iface = createInterface(library, resolveView);
            return iface.get('catalog', req.params.type, req.params.id, parseExtra(req.params.extra));
        })
        .then((payload) => res.json(payload))
        .catch(next);
}

function listen(port = Number(process.env.PORT) || 7000) {
    const app = createApp();
    return app.listen(port);
}

if (require.main === module) {
    const server = listen();
    server.on('listening', () => {
        const address = server.address();
        console.log(`Streamlol addon listening on ${address.port} (storage: ${storageMode()})`);
    });
}

module.exports = { createApp, listen, readToken };
