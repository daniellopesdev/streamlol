const { tmdb, credentialFor } = require('./tmdb');
const { cinemetaMeta, cinemetaCatalog, filmFromMeta } = require('./cinemeta');
const { mapPool, typeOf, tmdbKind, yearOf } = require('./discover');
const { personCredits } = require('./scopes');

const ROW_SIZE = 15;
const CACHE_MS = 6 * 60 * 60 * 1000;
const tmdbIdCache = new Map();
const imdbIdCache = new Map();
const infoCache = new Map();

function cached(map, key, load) {
    const hit = map.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const value = load();
    map.set(key, { at: Date.now(), value });
    Promise.resolve(value).catch(() => map.delete(key));
    return value;
}

function image(path, size) {
    return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

function tmdbIdFor(credential, type, imdbId) {
    return cached(tmdbIdCache, `${type}:${imdbId}`, async () => {
        const found = await tmdb(credential, `/find/${imdbId}`, { external_source: 'imdb_id' });
        const match = (type === 'series' ? found.tv_results : found.movie_results) || [];
        return match.length ? match[0].id : null;
    });
}

function imdbIdFor(credential, type, tmdbId) {
    return cached(imdbIdCache, `${type}:${tmdbId}`, async () => {
        const external = await tmdb(credential, `/${tmdbKind(type)}/${tmdbId}/external_ids`);
        return external.imdb_id || null;
    });
}

function tmdbInfo(credential, type, tmdbId) {
    const append = type === 'series' ? 'aggregate_credits,recommendations,similar' : 'credits,recommendations,similar';
    return cached(infoCache, `${type}:${tmdbId}`, () => tmdb(credential, `/${tmdbKind(type)}/${tmdbId}`, { append_to_response: append }));
}

async function tmdbFilms(credential, type, items, excludeId) {
    const unique = [];
    const seen = new Set();
    items.forEach((item) => {
        if (!item || !item.poster_path || seen.has(item.id)) return;
        seen.add(item.id);
        unique.push(item);
    });
    const films = await mapPool(unique.slice(0, ROW_SIZE + 5), 6, async (item) => {
        const imdbId = await imdbIdFor(credential, type, item.id).catch(() => null);
        if (!imdbId || imdbId === excludeId) return null;
        return {
            imdbId,
            type,
            tmdbId: item.id,
            title: item.title || item.name,
            year: yearOf(item.release_date || item.first_air_date),
            poster: image(item.poster_path, 'w342'),
            genres: [],
            imdbRating: null,
            platforms: [],
            description: item.overview || '',
        };
    });
    return films.filter(Boolean).slice(0, ROW_SIZE);
}

async function personRow(credential, type, person, role) {
    const pool = await personCredits(credential, type, person.id, role);
    return pool.slice().sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0));
}

async function cinemetaGenreRow(type, genres, imdbId) {
    if (!genres.length) return null;
    const metas = await cinemetaCatalog(type, 'top', { genre: genres[0] }).catch(() => []);
    const wanted = new Set(genres);
    const films = metas
        .filter((meta) => meta.id !== imdbId && /^tt\d+$/.test(meta.id || ''))
        .map((meta) => filmFromMeta(meta, type))
        .map((film, index) => ({ film, index, shared: film.genres.filter((genre) => wanted.has(genre)).length }))
        .sort((a, b) => b.shared - a.shared || a.index - b.index)
        .slice(0, ROW_SIZE)
        .map((entry) => entry.film);
    return films.length ? { id: 'genre', title: `More ${genres.slice(0, 2).join(' & ')}`, films } : null;
}

async function details(library, typeInput, imdbId) {
    if (!/^tt\d+$/.test(imdbId || '')) {
        const error = new Error('Invalid IMDb id');
        error.status = 400;
        throw error;
    }
    const type = typeOf(typeInput);
    const meta = (await cinemetaMeta(type, imdbId)) || {};
    const base = {
        imdbId,
        type,
        title: meta.name || null,
        year: String(meta.releaseInfo || meta.year || '').slice(0, 4),
        releaseInfo: meta.releaseInfo || meta.year || '',
        runtime: meta.runtime || null,
        poster: meta.poster || null,
        background: meta.background || null,
        logo: meta.logo || null,
        description: meta.description || '',
        genres: meta.genres || meta.genre || [],
        imdbRating: meta.imdbRating || null,
        trailer: (meta.trailers || []).find((item) => item.type === 'Trailer')?.source || null,
        cast: (meta.cast || []).slice(0, 10).map((name) => ({ id: null, name, character: null, photo: null })),
        directors: (meta.director || []).map((name) => ({ id: null, name })),
        directorLabel: type === 'series' ? 'Created by' : 'Directed by',
        source: 'cinemeta',
    };
    const credential = credentialFor(library);
    if (!credential) return base;
    try {
        const tmdbId = await tmdbIdFor(credential, type, imdbId);
        if (!tmdbId) return base;
        const info = await tmdbInfo(credential, type, tmdbId);
        const credits = type === 'series' ? info.aggregate_credits : info.credits;
        const cast = ((credits && credits.cast) || []).slice(0, 12).map((person) => ({
            id: person.id,
            name: person.name,
            character: person.character || (person.roles && person.roles[0] && person.roles[0].character) || null,
            photo: image(person.profile_path, 'w185'),
        }));
        const directors = type === 'series'
            ? (info.created_by || []).map((person) => ({ id: person.id, name: person.name }))
            : ((credits && credits.crew) || []).filter((person) => person.job === 'Director').map((person) => ({ id: person.id, name: person.name }));
        return {
            ...base,
            tmdbId,
            title: base.title || info.title || info.name,
            description: base.description || info.overview || '',
            background: base.background || image(info.backdrop_path, 'w1280'),
            genres: base.genres.length ? base.genres : (info.genres || []).map((genre) => genre.name),
            tmdbGenres: (info.genres || []).map((genre) => genre.id),
            cast: cast.length ? cast : base.cast,
            directors: directors.length ? directors : base.directors,
            seasons: info.number_of_seasons || null,
            source: 'tmdb',
        };
    } catch {
        return base;
    }
}

async function suggestions(library, typeInput, imdbId) {
    const type = typeOf(typeInput);
    const info = await details(library, type, imdbId);
    const credential = credentialFor(library);
    if (info.source !== 'tmdb' || !credential) {
        const row = await cinemetaGenreRow(type, info.genres, imdbId);
        return { source: 'cinemeta', rows: row ? [row] : [] };
    }
    const full = await tmdbInfo(credential, type, info.tmdbId);
    const lead = info.cast.find((person) => person.id);
    const maker = info.directors.find((person) => person.id);
    const genreIds = (info.tmdbGenres || []).slice(0, 2);
    const kind = tmdbKind(type);

    const rows = await Promise.all([
        tmdbFilms(credential, type, [
            ...((full.recommendations && full.recommendations.results) || []),
            ...((full.similar && full.similar.results) || []),
        ], imdbId).then((films) => ({ id: 'similar', title: 'More like this', films })),
        lead
            ? personRow(credential, type, lead, 'cast')
                .then((items) => tmdbFilms(credential, type, items, imdbId))
                .then((films) => ({ id: `cast_${lead.id}`, title: `Starring ${lead.name}`, films, person: lead, role: 'cast' }))
            : null,
        maker
            ? personRow(credential, type, maker, 'crew')
                .then((items) => tmdbFilms(credential, type, items, imdbId))
                .then((films) => ({ id: `crew_${maker.id}`, title: `${info.directorLabel} ${maker.name}`, films, person: maker, role: 'crew' }))
            : null,
        genreIds.length
            ? tmdb(credential, `/discover/${kind}`, {
                with_genres: genreIds.join(','),
                sort_by: 'popularity.desc',
                'vote_count.gte': 200,
                include_adult: false,
            })
                .then((payload) => tmdbFilms(credential, type, payload.results || [], imdbId))
                .then((films) => ({ id: 'genre', title: `More ${info.genres.slice(0, 2).join(' & ')}`, films }))
            : null,
    ].map((pending) => Promise.resolve(pending).catch(() => null)));

    return { source: 'tmdb', rows: rows.filter((row) => row && row.films.length) };
}

async function personFilms(library, typeInput, personId, role, name, excludeId) {
    const type = typeOf(typeInput);
    const credential = credentialFor(library);
    if (!credential) {
        const error = new Error('Cast and director suggestions need a TMDB token.');
        error.status = 412;
        error.code = 'tmdb_missing';
        throw error;
    }
    const person = { id: Number(personId), name };
    const items = await personRow(credential, type, person, role === 'crew' ? 'crew' : 'cast');
    const films = await tmdbFilms(credential, type, items, excludeId);
    const label = role === 'crew' ? (type === 'series' ? 'Created by' : 'Directed by') : 'Starring';
    return { id: `${role}_${personId}`, title: `${label} ${name || ''}`.trim(), films, person, role };
}

module.exports = { details, suggestions, personFilms };
