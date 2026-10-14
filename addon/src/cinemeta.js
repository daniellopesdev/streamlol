const CINEMETA = 'https://v3-cinemeta.strem.io';
const metas = new Map();

function cinemetaMeta(type, imdbId) {
    const kind = type === 'series' ? 'series' : 'movie';
    const key = `${kind}:${imdbId}`;
    if (!metas.has(key)) {
        const pending = fetch(`${CINEMETA}/meta/${kind}/${imdbId}.json`)
            .then((response) => (response.ok ? response.json() : {}))
            .then((payload) => payload.meta || null)
            .catch(() => null);
        metas.set(key, pending);
    }
    return metas.get(key);
}

async function imdbRating(imdbId, type = 'movie') {
    const meta = await cinemetaMeta(type, imdbId);
    return (meta && meta.imdbRating) || null;
}

async function cinemetaCatalog(type, catalog, extra = {}) {
    const query = Object.entries(extra)
        .filter(([, value]) => value !== undefined && value !== null && value !== '' && value !== 0)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&');
    const kind = type === 'series' ? 'series' : 'movie';
    const response = await fetch(`${CINEMETA}/catalog/${kind}/${catalog}${query ? `/${query}` : ''}.json`);
    if (!response.ok) {
        const error = new Error(`Cinemeta request failed (${response.status})`);
        error.status = 502;
        throw error;
    }
    const payload = await response.json();
    return payload.metas || [];
}

function filmFromMeta(meta, type) {
    return {
        imdbId: meta.id,
        type: type === 'series' ? 'series' : 'movie',
        tmdbId: null,
        title: meta.name,
        year: String(meta.releaseInfo || meta.year || '').slice(0, 4),
        poster: meta.poster || null,
        genres: meta.genres || meta.genre || [],
        imdbRating: meta.imdbRating || null,
        platforms: [],
        description: meta.description || '',
    };
}

module.exports = { cinemetaMeta, cinemetaCatalog, imdbRating, filmFromMeta };
