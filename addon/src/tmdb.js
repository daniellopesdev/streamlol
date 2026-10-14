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
    const headers = { accept: 'application/json' };
    if (V3_KEY_RE.test(credential)) {
        url.searchParams.set('api_key', credential);
    } else {
        headers.Authorization = `Bearer ${credential}`;
    }
    const response = await fetch(url, { headers });
    if (response.status === 401) {
        throw httpError('TMDB rejected the token. Check it in Shelves settings.', 401, 'tmdb_invalid');
    }
    if (!response.ok) {
        throw httpError(`TMDB request failed (${response.status})`, 502);
    }
    return response.json();
}

async function verifyCredential(credential) {
    const trimmed = String(credential || '').trim();
    if (!trimmed) throw httpError('Paste a TMDB API Read Access Token or API key.', 400);
    await tmdb(trimmed, '/authentication');
    return trimmed;
}

module.exports = { tmdb, credentialFor, credentialSource, verifyCredential };
