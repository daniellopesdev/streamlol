const { tmdb, credentialFor } = require('./tmdb');
const { imdbRating, cinemetaCatalog, filmFromMeta } = require('./cinemeta');
const { collapseProviders, expandPlatformIds, brandNamesForIds } = require('./platforms');

const CINEMETA_MAX_SKIP = 2000;
const BASE_GENRES = [
    'Action', 'Adventure', 'Animation', 'Biography', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family',
    'Fantasy', 'History', 'Horror', 'Mystery', 'Romance', 'Sci-Fi', 'Sport', 'Thriller', 'War', 'Western',
];
const CINEMETA_GENRES = {
    movie: BASE_GENRES,
    series: [...BASE_GENRES, 'Reality-TV', 'Talk-Show', 'Game-Show'],
};
const GENRE_ALIASES = { 'Sci-Fi': 'Science Fiction', 'Science Fiction': 'Sci-Fi' };
const SORTS = ['popular', 'rating', 'newest', 'votes'];
const TYPES = ['movie', 'series'];
const TV_NOISE_GENRES = ['10763', '10766', '10767'];

const referenceCache = new Map();
const factsCache = new Map();
const PAGE_TARGET = 20;
const MAX_SOURCE_PAGES = 6;

const COUNTRIES = [
    ['US', 'United States'],
    ['GB', 'United Kingdom'],
    ['CA', 'Canada'],
    ['AU', 'Australia'],
    ['IE', 'Ireland'],
    ['DE', 'Germany'],
    ['FR', 'France'],
    ['ES', 'Spain'],
    ['IT', 'Italy'],
    ['PT', 'Portugal'],
    ['NL', 'Netherlands'],
    ['SE', 'Sweden'],
    ['PL', 'Poland'],
    ['BR', 'Brazil'],
    ['MX', 'Mexico'],
    ['IN', 'India'],
    ['JP', 'Japan'],
    ['KR', 'South Korea'],
];

function asList(value) {
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    if (typeof value === 'string' && value.trim()) return value.split(',').map((item) => item.trim()).filter(Boolean);
    return [];
}

function typeOf(value) {
    return value === 'series' ? 'series' : 'movie';
}

function tmdbKind(type) {
    return type === 'series' ? 'tv' : 'movie';
}

function yearOf(date) {
    return typeof date === 'string' ? date.slice(0, 4) : '';
}

function sameGenre(a, b) {
    return a === b || GENRE_ALIASES[a] === b;
}

function matchesLocal(movie, filters) {
    const include = asList(filters.genres);
    const exclude = asList(filters.excludeGenres);
    const genreIds = (movie.genre_ids || []).map(String);
    if (include.length && !include.every((id) => genreIds.includes(id))) return false;
    if (exclude.some((id) => genreIds.includes(id))) return false;
    const year = yearOf(movie.release_date || movie.first_air_date);
    if (filters.yearFrom && year && year < String(filters.yearFrom)) return false;
    if (filters.yearTo && year && year > String(filters.yearTo)) return false;
    return true;
}

function matchesFilm(film, filters) {
    const genres = film.genres || [];
    const has = (name) => genres.some((genre) => sameGenre(genre, name));
    if (!asList(filters.genres).every(has)) return false;
    if (asList(filters.excludeGenres).some(has)) return false;
    if (filters.yearFrom && film.year && film.year < String(filters.yearFrom)) return false;
    if (filters.yearTo && film.year && film.year > String(filters.yearTo)) return false;
    if (filters.minImdb && !(Number(film.imdbRating) >= Number(filters.minImdb))) return false;
    return true;
}

async function mapPool(items, limit, worker) {
    const results = new Array(items.length);
    let cursor = 0;
    async function run() {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await worker(items[index], index);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
    return results;
}

async function tmdbReference(credential, region, type) {
    const key = `${type}:${region}`;
    const cached = referenceCache.get(key);
    if (cached && Date.now() - cached.at < 24 * 60 * 60 * 1000) return cached.value;
    const kind = tmdbKind(type);
    const [genres, providers] = await Promise.all([
        tmdb(credential, `/genre/${kind}/list`),
        tmdb(credential, `/watch/providers/${kind}`, { watch_region: region }),
    ]);
    const value = {
        tmdbGenres: genres.genres || [],
        providers: collapseProviders(
            (providers.results || []).map((item) => ({
                id: item.provider_id,
                name: item.provider_name,
                priority: (item.display_priorities && item.display_priorities[region]) ?? item.display_priority ?? 999,
            }))
        ),
    };
    referenceCache.set(key, { at: Date.now(), value });
    return value;
}

async function reference(credential, country, type = 'movie') {
    const region = /^[A-Z]{2}$/.test(country) ? country : 'US';
    const kind = typeOf(type);
    const countries = COUNTRIES.map(([code, name]) => ({ code, name }));
    if (!credential) {
        return {
            source: 'cinemeta',
            type: kind,
            countries,
            genres: CINEMETA_GENRES[kind].map((name) => ({ id: name, name })),
            providers: [],
        };
    }
    const ref = await tmdbReference(credential, region, kind);
    return {
        source: 'tmdb',
        type: kind,
        countries,
        genres: ref.tmdbGenres.map((genre) => ({ id: genre.name, name: genre.name })),
        providers: ref.providers,
    };
}

function tmdbFacts(credential, type, tmdbId) {
    const kind = tmdbKind(type);
    const key = `${kind}:${tmdbId}`;
    if (!factsCache.has(key)) {
        const pending = Promise.all([
            tmdb(credential, `/${kind}/${tmdbId}/external_ids`),
            tmdb(credential, `/${kind}/${tmdbId}/watch/providers`),
        ]).then(([external, providers]) => ({
            imdbId: external.imdb_id || null,
            providers: providers.results || {},
        }));
        factsCache.set(key, pending);
        pending.catch(() => factsCache.delete(key));
    }
    return factsCache.get(key);
}

function providerIds(providerMap, country) {
    const region = providerMap[country] || {};
    return new Set(
        ['flatrate', 'free', 'ads', 'rent', 'buy']
            .flatMap((key) => region[key] || [])
            .map((item) => String(item.provider_id))
    );
}

function tmdbGenreIds(names, tmdbGenres) {
    return asList(names)
        .map((name) => {
            if (/^\d+$/.test(name)) return name;
            const match = tmdbGenres.find((genre) => sameGenre(genre.name, name));
            return match ? String(match.id) : null;
        })
        .filter(Boolean);
}

function tmdbParams(filters, page) {
    const series = filters.type === 'series';
    const dateKey = series ? 'first_air_date' : 'primary_release_date';
    const today = new Date().toISOString().slice(0, 10);
    const sort = {
        popular: 'popularity.desc',
        rating: 'vote_average.desc',
        newest: `${series ? 'first_air_date' : 'primary_release_date'}.desc`,
        votes: 'vote_count.desc',
    }[filters.sort] || 'popularity.desc';
    const minVotes = Number(filters.minVotes) || 0;
    const platforms = asList(filters.platforms).join('|');
    const params = {
        include_adult: false,
        page,
        sort_by: sort,
        with_genres: filters.genres.join(',') || undefined,
        without_genres: filters.excludeGenres.join(',') || undefined,
        with_watch_providers: platforms || undefined,
        with_watch_monetization_types: platforms ? 'flatrate|free|ads|rent|buy' : undefined,
        watch_region: platforms ? filters.country : undefined,
        'vote_count.gte': filters.sort === 'rating' ? Math.max(minVotes, series ? 150 : 300) : (minVotes || undefined),
        [`${dateKey}.gte`]: filters.yearFrom ? `${filters.yearFrom}-01-01` : undefined,
        [`${dateKey}.lte`]: filters.yearTo ? `${filters.yearTo}-12-31` : (filters.sort === 'newest' ? today : undefined),
    };
    if (filters.minImdb) params['vote_average.gte'] = Math.max(0, Number(filters.minImdb) - 1.5);
    if (series) {
        if (!params['vote_count.gte']) params['vote_count.gte'] = 100;
        if (!filters.genres.length) {
            params.without_genres = [...filters.excludeGenres, ...TV_NOISE_GENRES]
                .filter((id, index, all) => all.indexOf(id) === index)
                .join(',');
        }
    }
    return params;
}

async function tmdbDiscover(credential, library, filters, cursor, hideViewed) {
    const { country, type } = filters;
    const kind = tmdbKind(type);
    const ref = await tmdbReference(credential, country, type);
    const genreNames = new Map(ref.tmdbGenres.map((genre) => [String(genre.id), genre.name]));
    const wantedPlatforms = expandPlatformIds(filters.platforms, ref.providers);
    const idFilters = {
        ...filters,
        genres: tmdbGenreIds(filters.genres, ref.tmdbGenres),
        excludeGenres: tmdbGenreIds(filters.excludeGenres, ref.tmdbGenres),
        platforms: wantedPlatforms,
    };
    const results = [];
    let page = Number(cursor) || 1;
    let totalPages = page;
    let pagesUsed = 0;

    while (results.length < PAGE_TARGET && pagesUsed < MAX_SOURCE_PAGES && page <= totalPages) {
        const payload = filters.q
            ? await tmdb(credential, `/search/${kind}`, { query: filters.q, page, include_adult: false })
            : await tmdb(credential, `/discover/${kind}`, tmdbParams(idFilters, page));
        totalPages = Math.min(payload.total_pages || page, 500);
        const candidates = (payload.results || []).filter((item) => matchesLocal(item, idFilters));
        const enriched = await mapPool(candidates, 5, async (item) => {
            const facts = await tmdbFacts(credential, type, item.id).catch(() => null);
            if (!facts || !facts.imdbId) return null;
            if (hideViewed && library.status[facts.imdbId] === 'viewed') return null;
            const available = providerIds(facts.providers, country);
            if (filters.q && wantedPlatforms.length && !wantedPlatforms.some((id) => available.has(id))) return null;
            const rating = await imdbRating(facts.imdbId, type);
            if (filters.minImdb && !(Number(rating) >= Number(filters.minImdb))) return null;
            return {
                imdbId: facts.imdbId,
                type,
                tmdbId: item.id,
                title: item.title || item.name,
                year: yearOf(item.release_date || item.first_air_date),
                poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
                genres: (item.genre_ids || []).map((id) => genreNames.get(String(id))).filter(Boolean),
                imdbRating: rating,
                platforms: brandNamesForIds([...available], ref.providers),
                description: item.overview || '',
            };
        });
        results.push(...enriched.filter(Boolean));
        pagesUsed += 1;
        page += 1;
    }

    return { source: 'tmdb', results, nextCursor: page <= totalPages ? String(page) : null };
}

function cinemetaStart(filters) {
    const thisYear = new Date().getFullYear();
    const known = CINEMETA_GENRES[filters.type];
    const genre = asList(filters.genres)
        .map((name) => (known.includes(name) ? name : GENRE_ALIASES[name] || name))
        .find((name) => known.includes(name)) || '';
    const base = { type: filters.type, skip: 0 };
    if (filters.q) return { ...base, catalog: 'top', search: filters.q };
    if (filters.sort === 'rating') return { ...base, catalog: 'imdbRating', genre };
    if (filters.sort === 'newest' || (filters.yearFrom && filters.yearFrom === filters.yearTo)) {
        return { ...base, catalog: 'year', genre: String(Math.min(Number(filters.yearTo) || thisYear, thisYear)) };
    }
    return { ...base, catalog: 'top', genre };
}

function cinemetaNext(state, count, filters) {
    if (state.search) return null;
    if (count > 0 && state.skip + count < CINEMETA_MAX_SKIP) return { ...state, skip: state.skip + count };
    if (state.catalog === 'year') {
        const previous = Number(state.genre) - 1;
        if (previous >= Math.max(1900, Number(filters.yearFrom) || 1900)) return { ...state, genre: String(previous), skip: 0 };
    }
    return null;
}

function encodeCursor(state) {
    return state ? Buffer.from(JSON.stringify(state)).toString('base64url') : null;
}

function decodeCursor(cursor) {
    try {
        const state = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
        return state && typeof state.catalog === 'string' ? state : null;
    } catch {
        return null;
    }
}

async function cinemetaDiscover(library, filters, cursor, hideViewed) {
    let state = (cursor && decodeCursor(cursor)) || cinemetaStart(filters);
    const results = [];
    const seen = new Set();
    let pagesUsed = 0;

    while (state && results.length < PAGE_TARGET && pagesUsed < MAX_SOURCE_PAGES * 2) {
        const metas = await cinemetaCatalog(filters.type, state.catalog, {
            genre: state.genre,
            search: state.search,
            skip: state.skip,
        });
        const films = metas
            .filter((meta) => /^tt\d+$/.test(meta.id || '') && !seen.has(meta.id))
            .map((meta) => {
                seen.add(meta.id);
                return filmFromMeta(meta, filters.type);
            })
            .filter((film) => !(hideViewed && library.status[film.imdbId] === 'viewed'))
            .filter((film) => matchesFilm(film, { ...filters, minImdb: '' }));
        if (filters.minImdb) {
            await mapPool(films.filter((film) => !film.imdbRating), 5, async (film) => {
                film.imdbRating = await imdbRating(film.imdbId, filters.type);
            });
        }
        results.push(...films.filter((film) => matchesFilm(film, filters)));
        state = cinemetaNext(state, metas.length, filters);
        pagesUsed += 1;
    }

    const notice = asList(filters.platforms).length
        ? 'Streaming platform filters need a TMDB token (Settings).'
        : null;
    return { source: 'cinemeta', results, nextCursor: encodeCursor(state), notice };
}

async function discover(library, filters, cursor) {
    const credential = credentialFor(library);
    const country = /^[A-Z]{2}$/.test(filters.country || '') ? filters.country : (library.settings.country || 'US');
    const hideViewed = filters.hideViewed !== false && filters.hideViewed !== 'false';
    const normalized = {
        ...filters,
        type: typeOf(filters.type),
        country,
        sort: SORTS.includes(filters.sort) ? filters.sort : 'popular',
        genres: asList(filters.genres),
        excludeGenres: asList(filters.excludeGenres),
        platforms: asList(filters.platforms),
    };
    if (credential) return tmdbDiscover(credential, library, normalized, cursor, hideViewed);
    return cinemetaDiscover(library, normalized, cursor, hideViewed);
}

module.exports = {
    COUNTRIES,
    SORTS,
    TYPES,
    asList,
    typeOf,
    tmdbKind,
    yearOf,
    mapPool,
    matchesLocal,
    matchesFilm,
    discover,
    reference,
};
