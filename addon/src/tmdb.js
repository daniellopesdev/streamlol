const { cached, HOUR } = require('./cache');
const TMDB_ROOT = 'https://api.themoviedb.org/3';
const V3_KEY_RE = /^[a-f0-9]{32}$/i;

function httpError(message, status, code) {
    const error = new Error(message);
    error.status = status;
    if (code) error.code = code;
    return error;
}

function credentialFor(library) {
    return (library && library.settings && library.settings.tmdbToken) || process.env.TMDB_TOKEN || '';
}

function credentialSource(library) {
    if (library && library.settings && library.settings.tmdbToken) return 'user';
    if (process.env.TMDB_TOKEN) return 'server';
    return null;
}

async function tmdb(credential, pathname, params = {}) {
    if (!credential) {
        throw httpError('Add your TMDB token in Shelves settings to use Discover.', 412, 'tmdb_missing');
    }
    const url = new URL(`${TMDB_ROOT}${pathname}`);
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });
    url.searchParams.sort();
    // Only public metadata is shared across credentials. Authentication and lists bypass it.
    const cacheable = /^\/(genre|watch\/providers|discover|search|find|person|collection|movie|tv)\//.test(pathname)
        && !/\/(account_states|rating|lists)(\/|$)/.test(pathname)
        && ![...url.searchParams.keys()].some((key) => key.endsWith('session_id') || key === 'api_key')
        && !/(^|,)(account_states|rating|lists)(,|$)/.test(url.searchParams.get('append_to_response') || '');
    const cacheKey = `tmdb:${url}`;
    const ttl = /^\/(discover|search)\//.test(pathname) || /\/(popular|top_rated)$/.test(pathname)
        ? HOUR / 4 : (/^\/(genre|watch\/providers)\//.test(pathname) ? 24 * HOUR : 6 * HOUR);
    const headers = { accept: 'application/json' };
    if (V3_KEY_RE.test(credential)) {
        url.searchParams.set('api_key', credential);
    } else {
        headers.Authorization = `Bearer ${credential}`;
    }
    const load = async () => {
        const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
        if (response.status === 401) {
            throw httpError('TMDB rejected the token. Check it in Shelves settings.', 401, 'tmdb_invalid');
        }
        if (!response.ok) {
            throw httpError(`TMDB request failed (${response.status})`, 502);
        }
        return response.json();
    };
    return cacheable ? cached(cacheKey, ttl, load) : load();
}

async function verifyCredential(credential) {
    const trimmed = String(credential || '').trim();
    if (!trimmed) throw httpError('Paste a TMDB API Read Access Token or API key.', 400);
    await tmdb(trimmed, '/authentication');
    return trimmed;
}

module.exports = { tmdb, credentialFor, credentialSource, verifyCredential };
