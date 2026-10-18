const { tmdb, credentialFor } = require('./tmdb');
const { imdbRating, cinemetaCatalog, filmFromMeta } = require('./cinemeta');
const { collapseProviders, expandPlatformIds, brandNamesForIds } = require('./platforms');
const { scopeLabel, scopeParams, scopePool, isPooled, movieOnly } = require('./scopes');

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
const SORTS = ['popular', 'rating', 'newest', 'votes', 'list'];
const TYPES = ['movie', 'series'];
const TV_NOISE_GENRES = ['10763', '10766', '10767'];

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
    return Promise.all([
        tmdb(credential, `/${kind}/${tmdbId}/external_ids`),
        tmdb(credential, `/${kind}/${tmdbId}/watch/providers`),
    ]).then(([external, providers]) => ({
        imdbId: external.imdb_id || null,
        providers: providers.results || {},
    }));
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

function byImdbDesc(a, b) {
    return (Number(b.imdbRating) || 0) - (Number(a.imdbRating) || 0);
}

function ratingCanUseTopRated(filters, wantedPlatforms) {
    return filters.sort === 'rating'
        && !filters.q
        && !filters.scope
        && !filters.genres.length
        && !filters.excludeGenres.length
        && !filters.yearFrom
        && !filters.yearTo
        && !wantedPlatforms.length
        && !filters.minVotes;
}

function tmdbParams(filters, page) {
    const series = filters.type === 'series';
    const dateKey = series ? 'first_air_date' : 'primary_release_date';
    const today = new Date().toISOString().slice(0, 10);
    const rating = filters.sort === 'rating';
    const sort = {
        popular: 'popularity.desc',
        rating: 'vote_average.desc',
        newest: `${series ? 'first_air_date' : 'primary_release_date'}.desc`,
        votes: 'vote_count.desc',
    }[filters.sort] || 'popularity.desc';
    const minVotes = Number(filters.minVotes) || 0;
    const platforms = asList(filters.platforms).join('|');
    // Rating sort needs a high vote floor so obscure 10.0 TMDB scores don't float above classics.
    // Scoped searches (company/keyword) are niche, so the floor is much lower there.
    const ratingFloor = filters.scope ? 50 : (series ? 200 : 1000);
    const voteFloor = rating ? Math.max(minVotes, ratingFloor) : minVotes;
    const params = {
        ...scopeParams(filters.scope),
        include_adult: false,
        page,
        sort_by: sort,
        with_genres: filters.genres.join(',') || undefined,
        without_genres: filters.excludeGenres.join(',') || undefined,
        with_watch_providers: platforms || undefined,
        with_watch_monetization_types: platforms ? 'flatrate|free|ads|rent|buy' : undefined,
        watch_region: platforms ? filters.country : undefined,
        'vote_count.gte': voteFloor || undefined,
        [`${dateKey}.gte`]: filters.yearFrom ? `${filters.yearFrom}-01-01` : undefined,
        [`${dateKey}.lte`]: filters.yearTo
            ? `${filters.yearTo}-12-31`
            : (filters.sort === 'newest' || rating ? today : undefined),
    };
    if (filters.minImdb) params['vote_average.gte'] = Math.max(0, Number(filters.minImdb) - 0.5);
    else if (rating && !filters.scope) params['vote_average.gte'] = 7;
    if (series) {
        if (!params['vote_count.gte'] && !filters.scope) params['vote_count.gte'] = 100;
        if (!filters.genres.length) {
            params.without_genres = [...filters.excludeGenres, ...TV_NOISE_GENRES]
                .filter((id, index, all) => all.indexOf(id) === index)
                .join(',');
        }
    }
    return params;
}

function dateOf(item) {
    return item.release_date || item.first_air_date || '';
}

function titleMatches(item, q) {
    if (!q) return true;
    const needle = q.toLowerCase();
    return [item.title, item.name, item.original_title, item.original_name]
        .some((value) => typeof value === 'string' && value.toLowerCase().includes(needle));
}

function sortPool(items, sort) {
    const sorted = items.slice();
    // Pre-rank by TMDB vote_average (not Bayesian) so top-rated candidates are closer
    // to the IMDb order we apply after enrichment.
    if (sort === 'rating') {
        sorted.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0)
            || (b.vote_count || 0) - (a.vote_count || 0));
    } else if (sort === 'newest') sorted.sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
    else if (sort === 'votes') sorted.sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0));
    else if (sort === 'list') sorted.sort((a, b) => (a.listOrder || 0) - (b.listOrder || 0));
    else sorted.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    return sorted;
}

function enricher(credential, library, filters, ctx) {
    const { type, country } = filters;
    return async (item) => {
        const facts = await tmdbFacts(credential, type, item.id).catch(() => null);
        if (!facts || !facts.imdbId) return null;
        if (ctx.hideViewed && library.status[facts.imdbId] === 'viewed') return null;
        const available = providerIds(facts.providers, country);
        if (ctx.checkPlatforms && ctx.wantedPlatforms.length && !ctx.wantedPlatforms.some((id) => available.has(id))) return null;
        const rating = await imdbRating(facts.imdbId, type);
        if (filters.minImdb && !(Number(rating) >= Number(filters.minImdb))) return null;
        if (filters.sort === 'rating' && !filters.scope && !(Number(rating) > 0)) return null;
        return {
            imdbId: facts.imdbId,
            type,
            tmdbId: item.id,
            title: item.title || item.name,
            year: yearOf(dateOf(item)),
            poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
            genres: (item.genre_ids || []).map((id) => ctx.genreNames.get(String(id))).filter(Boolean),
            imdbRating: rating,
            platforms: brandNamesForIds([...available], ctx.ref.providers),
            description: item.overview || '',
        };
    };
}

async function pooledDiscover(credential, library, filters, idFilters, ctx, cursor) {
    const today = new Date().toISOString().slice(0, 10);
    const pool = await scopePool(credential, filters.scope, filters.type);
    const minVotes = Number(filters.minVotes) || 0;
    const releasedOnly = filters.sort === 'rating' || filters.sort === 'votes';
    const rating = filters.sort === 'rating';
    const candidates = sortPool(pool.filter((item) => {
        if (!item.poster_path) return false;
        if (!matchesLocal(item, idFilters)) return false;
        if (!titleMatches(item, filters.q)) return false;
        if (minVotes && (item.vote_count || 0) < minVotes) return false;
        const date = dateOf(item);
        if (releasedOnly && (!date || date > today)) return false;
        return true;
    }), filters.sort);

    const enrich = enricher(credential, library, filters, { ...ctx, checkPlatforms: true });
    let offset = Number(cursor) || 0;

    // Top rated: enrich a wider window, sort by IMDb, then paginate so ratings stay sequential.
    if (rating) {
        const window = Math.min(candidates.length, offset + PAGE_TARGET * 4);
        const batch = [];
        let cursorAt = 0;
        while (batch.length < window && cursorAt < candidates.length) {
            const slice = candidates.slice(cursorAt, cursorAt + 10);
            cursorAt += slice.length;
            const enriched = await mapPool(slice, 5, enrich);
            batch.push(...enriched.filter(Boolean));
        }
        batch.sort(byImdbDesc);
        const results = batch.slice(offset, offset + PAGE_TARGET);
        const next = offset + PAGE_TARGET;
        return {
            source: 'tmdb',
            scope: { ...filters.scope, label: scopeLabel(filters.scope, filters.type), total: candidates.length },
            results,
            nextCursor: next < batch.length || cursorAt < candidates.length ? String(next) : null,
        };
    }

    const results = [];
    const budget = offset + PAGE_TARGET * 6;
    while (results.length < PAGE_TARGET && offset < candidates.length && offset < budget) {
        const slice = candidates.slice(offset, offset + 10);
        offset += slice.length;
        const enriched = await mapPool(slice, 5, enrich);
        results.push(...enriched.filter(Boolean));
    }
    return {
        source: 'tmdb',
        scope: { ...filters.scope, label: scopeLabel(filters.scope, filters.type), total: candidates.length },
        results,
        nextCursor: offset < candidates.length ? String(offset) : null,
    };
}

async function tmdbDiscover(credential, library, filters, cursor, hideViewed) {
    const { country, type, scope } = filters;
    const kind = tmdbKind(type);
    if (scope && movieOnly(scope) && type === 'series') {
        return { source: 'tmdb', results: [], nextCursor: null, notice: `${scope.name} only has movies. Switch to Movies.` };
    }
    const ref = await tmdbReference(credential, country, type);
    const genreNames = new Map(ref.tmdbGenres.map((genre) => [String(genre.id), genre.name]));
    const wantedPlatforms = expandPlatformIds(filters.platforms, ref.providers);
    const idFilters = {
        ...filters,
        genres: tmdbGenreIds(filters.genres, ref.tmdbGenres),
        excludeGenres: tmdbGenreIds(filters.excludeGenres, ref.tmdbGenres),
        platforms: wantedPlatforms,
    };
    const ctx = { ref, genreNames, wantedPlatforms, hideViewed };
    if (isPooled(scope)) return pooledDiscover(credential, library, filters, idFilters, ctx, cursor);

    const rating = filters.sort === 'rating';
    const useTopRated = ratingCanUseTopRated(filters, wantedPlatforms);
    const titleSearch = filters.q && !scope;
    const today = new Date().toISOString().slice(0, 10);
    const enrich = enricher(credential, library, filters, { ...ctx, checkPlatforms: titleSearch });

    // Top rated: gather several TMDB pages, enrich to IMDb, sort, then page by offset.
    // Sorting only the current TMDB page left ratings non-sequential after IMDb remap.
    if (rating && !titleSearch) {
        const skip = Number(cursor) || 0;
        const gather = skip + PAGE_TARGET * 3;
        const pool = [];
        let page = 1;
        let totalPages = 1;
        let pagesUsed = 0;
        const pageBudget = MAX_SOURCE_PAGES * 3;
        while (pool.length < gather && pagesUsed < pageBudget && page <= totalPages) {
            const payload = useTopRated
                ? await tmdb(credential, `/${kind}/top_rated`, { page, language: 'en-US' })
                : await tmdb(credential, `/discover/${kind}`, tmdbParams(idFilters, page));
            totalPages = Math.min(payload.total_pages || page, 500);
            const candidates = (payload.results || []).filter((item) => {
                if (!matchesLocal(item, idFilters)) return false;
                if (scope && !titleMatches(item, filters.q)) return false;
                const date = dateOf(item);
                if (date && date > today) return false;
                return true;
            });
            const enriched = await mapPool(candidates, 5, enrich);
            pool.push(...enriched.filter(Boolean));
            pagesUsed += 1;
            page += 1;
        }
        pool.sort(byImdbDesc);
        const results = pool.slice(skip, skip + PAGE_TARGET);
        const next = skip + PAGE_TARGET;
        return {
            source: 'tmdb',
            scope: scope ? { ...scope, label: scopeLabel(scope, type) } : null,
            results,
            nextCursor: next < pool.length || page <= totalPages ? String(next) : null,
        };
    }

    const results = [];
    let page = Number(cursor) || 1;
    let totalPages = page;
    let pagesUsed = 0;

    while (results.length < PAGE_TARGET && pagesUsed < MAX_SOURCE_PAGES && page <= totalPages) {
        const payload = titleSearch
            ? await tmdb(credential, `/search/${kind}`, { query: filters.q, page, include_adult: false })
            : await tmdb(credential, `/discover/${kind}`, tmdbParams(idFilters, page));
        totalPages = Math.min(payload.total_pages || page, 500);
        const candidates = (payload.results || []).filter((item) => {
            if (!matchesLocal(item, idFilters)) return false;
            if (scope && !titleMatches(item, filters.q)) return false;
            return true;
        });
        const enriched = await mapPool(candidates, 5, enrich);
        results.push(...enriched.filter(Boolean));
        pagesUsed += 1;
        page += 1;
    }

    return {
        source: 'tmdb',
        scope: scope ? { ...scope, label: scopeLabel(scope, type) } : null,
        results,
        nextCursor: page <= totalPages ? String(page) : null,
    };
}

function cinemetaStart(filters) {
    const thisYear = new Date().getFullYear();
    const known = CINEMETA_GENRES[filters.type];
    const genre = asList(filters.genres)
        .map((name) => (known.includes(name) ? name : GENRE_ALIASES[name] || name))
        .find((name) => known.includes(name)) || '';
    const base = { type: filters.type, skip: 0 };
    if (filters.q) return { ...base, catalog: 'top', search: filters.q };
    // Cinemeta's "imdbRating" catalog is now "Featured" (new titles), not an IMDb chart.
    // Without TMDB we scrape Popular and re-rank locally by IMDb score.
    if (filters.sort === 'rating') return { ...base, catalog: 'top', genre, rank: 'imdb' };
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
    const rankByImdb = filters.sort === 'rating' || state.rank === 'imdb';
    // Rating without TMDB needs a wider scrape so local IMDb re-rank has enough candidates.
    const pageBudget = rankByImdb ? MAX_SOURCE_PAGES * 4 : MAX_SOURCE_PAGES * 2;
    const target = rankByImdb ? PAGE_TARGET * 3 : PAGE_TARGET;

    while (state && results.length < target && pagesUsed < pageBudget) {
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
        if (filters.minImdb || rankByImdb) {
            await mapPool(films.filter((film) => !film.imdbRating), 5, async (film) => {
                film.imdbRating = await imdbRating(film.imdbId, filters.type);
            });
        }
        results.push(...films.filter((film) => matchesFilm(film, filters)));
        state = cinemetaNext(state, metas.length, filters);
        if (state && rankByImdb) state = { ...state, rank: 'imdb' };
        pagesUsed += 1;
    }

    if (rankByImdb) {
        results.sort(byImdbDesc);
        results.splice(PAGE_TARGET);
    }

    const notices = [];
    if (asList(filters.platforms).length) notices.push('Streaming platform filters need a TMDB token (Settings).');
    if (rankByImdb) notices.push('Top rated is approximate without TMDB — add a token in Settings for the real chart.');
    return { source: 'cinemeta', results, nextCursor: encodeCursor(state), notice: notices.join(' ') || null };
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
        scope: filters.scope || null,
    };
    if (credential) return tmdbDiscover(credential, library, normalized, cursor, hideViewed);
    if (normalized.scope) {
        const error = new Error('People, collections and company search need a TMDB token.');
        error.status = 412;
        error.code = 'tmdb_missing';
        throw error;
    }
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
