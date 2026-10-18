const CINEMETA = 'https://v3-cinemeta.strem.io';
const { cached, HOUR } = require('./cache');

function cinemetaMeta(type, imdbId, { onError } = {}) {
    const kind = type === 'series' ? 'series' : 'movie';
    const key = `${kind}:${imdbId}`;
    return cached(`cinemeta:meta:${key}`, 6 * HOUR, () =>
        fetch(`${CINEMETA}/meta/${kind}/${imdbId}.json`, { signal: AbortSignal.timeout(15000) })
            .then((response) => {
                if (!response.ok) throw new Error(`Cinemeta request failed (${response.status})`);
                return response.json();
            })
            .then((payload) => payload.meta || null)
    ).catch(() => { onError?.(); return null; });
}

async function imdbRating(imdbId, type = 'movie', options) {
    const meta = await cinemetaMeta(type, imdbId, options);
    return (meta && meta.imdbRating) || null;
}

async function cinemetaCatalog(type, catalog, extra = {}) {
    const query = Object.entries(extra)
        .sort(([a], [b]) => a.localeCompare(b))
        .filter(([, value]) => value !== undefined && value !== null && value !== '' && value !== 0)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&');
    const kind = type === 'series' ? 'series' : 'movie';
    const url = `${CINEMETA}/catalog/${kind}/${catalog}${query ? `/${query}` : ''}.json`;
    return cached(`cinemeta:catalog:${url}`, HOUR / 4, async () => {
        const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) {
            const error = new Error(`Cinemeta request failed (${response.status})`);
            error.status = 502;
            throw error;
        }
        const payload = await response.json();
        return payload.metas || [];
    });
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
