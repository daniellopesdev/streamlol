const { createId } = require('./store');
const { asList, SORTS, typeOf } = require('./discover');
const { brandName } = require('./platforms');
const { cleanScope } = require('./scopes');

const IMDB_RE = /^tt\d{4,}$/;

function httpError(message, status) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function cleanFilm(input, previous = {}) {
    if (!IMDB_RE.test(input.imdbId || '')) throw httpError('Invalid IMDb id', 400);
    return {
        imdbId: input.imdbId,
        type: input.type === 'series' || input.type === 'movie' ? input.type : (previous.type || 'movie'),
        title: String(input.title || previous.title || input.imdbId).slice(0, 200),
        year: String(input.year || previous.year || '').slice(0, 4),
        poster: typeof input.poster === 'string' && input.poster.startsWith('https://')
            ? input.poster
            : (previous.poster || null),
        genres: Array.isArray(input.genres) ? input.genres.map(String).slice(0, 12) : (previous.genres || []),
        imdbRating: input.imdbRating ? String(input.imdbRating) : (previous.imdbRating || null),
        platforms: Array.isArray(input.platforms)
            ? [...new Set(input.platforms.map((name) => brandName(name)).filter(Boolean))].slice(0, 20)
            : (previous.platforms || []),
        description: typeof input.description === 'string' ? input.description.slice(0, 1000) : (previous.description || ''),
        addedAt: previous.addedAt || Date.now(),
        viewedAt: previous.viewedAt || null,
    };
}

function cleanFilters(input = {}) {
    return {
        q: String(input.q || '').slice(0, 120),
        sort: SORTS.includes(input.sort) ? input.sort : 'popular',
        type: typeOf(input.type),
        genres: asList(input.genres).slice(0, 12),
        excludeGenres: asList(input.excludeGenres).slice(0, 12),
        yearFrom: input.yearFrom ? String(input.yearFrom).slice(0, 4) : '',
        yearTo: input.yearTo ? String(input.yearTo).slice(0, 4) : '',
        minImdb: input.minImdb ? String(input.minImdb) : '',
        minVotes: input.minVotes ? String(input.minVotes) : '',
        platforms: asList(input.platforms).slice(0, 12),
        country: /^[A-Z]{2}$/.test(input.country || '') ? input.country : '',
        hideViewed: input.hideViewed !== false && input.hideViewed !== 'false',
        scope: cleanScope(input.scope),
    };
}

function upsertFilm(library, input, status) {
    const film = cleanFilm(input, library.films[input.imdbId]);
    library.films[film.imdbId] = film;
    if (status === 'viewed') {
        library.status[film.imdbId] = 'viewed';
        film.viewedAt = film.viewedAt || Date.now();
    } else if (status === 'library' || !library.status[film.imdbId]) {
        if (library.status[film.imdbId] !== 'viewed') library.status[film.imdbId] = 'library';
    }
    return film;
}

function setStatus(library, imdbId, status) {
    if (!library.films[imdbId]) throw httpError('Film not found', 404);
    if (status !== 'library' && status !== 'viewed') throw httpError('Invalid status', 400);
    library.status[imdbId] = status;
    if (status === 'viewed') library.films[imdbId].viewedAt = library.films[imdbId].viewedAt || Date.now();
    return library.films[imdbId];
}

function setViewedAt(library, imdbId, viewedAt) {
    const film = library.films[imdbId];
    if (!film || library.status[imdbId] !== 'viewed') throw httpError('Film is not marked viewed', 404);
    const time = Number(viewedAt);
    if (!Number.isFinite(time) || time < Date.UTC(1950, 0, 1) || time > Date.now() + 24 * 60 * 60 * 1000) {
        throw httpError('Invalid viewed date', 400);
    }
    film.viewedAt = time;
    return film;
}

function setReview(library, imdbId, input) {
    if (!library.films[imdbId]) throw httpError('Film not found', 404);
    const score = Number(input.score);
    if (!Number.isFinite(score) || score < 1 || score > 10) throw httpError('Score must be from 1 to 10', 400);
    library.reviews[imdbId] = {
        score: Math.round(score * 2) / 2,
        note: String(input.note || '').slice(0, 500),
        updatedAt: Date.now(),
    };
    library.status[imdbId] = 'viewed';
    library.films[imdbId].viewedAt = library.films[imdbId].viewedAt || Date.now();
    return library.reviews[imdbId];
}

function clearReview(library, imdbId) {
    delete library.reviews[imdbId];
}

function removeFilm(library, imdbId) {
    delete library.films[imdbId];
    delete library.status[imdbId];
    delete library.reviews[imdbId];
    library.lists.forEach((list) => {
        list.filmIds = list.filmIds.filter((id) => id !== imdbId);
    });
}

function addList(library, name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) throw httpError('List name is required', 400);
    const list = {
        id: createId(),
        name: trimmed.slice(0, 80),
        filmIds: [],
        order: library.lists.length,
    };
    library.lists.push(list);
    return list;
}

function renameList(library, id, name) {
    const list = library.lists.find((item) => item.id === id);
    if (!list) throw httpError('List not found', 404);
    const trimmed = String(name || '').trim();
    if (!trimmed) throw httpError('List name is required', 400);
    list.name = trimmed.slice(0, 80);
    return list;
}

function deleteList(library, id) {
    library.lists = library.lists.filter((item) => item.id !== id);
}

function reorderLists(library, ids) {
    const order = new Map(ids.map((id, index) => [id, index]));
    library.lists.forEach((list) => {
        if (order.has(list.id)) list.order = order.get(list.id);
    });
    library.lists.sort((a, b) => (a.order || 0) - (b.order || 0));
}

function addFilmToList(library, listId, imdbId) {
    const list = library.lists.find((item) => item.id === listId);
    if (!list) throw httpError('List not found', 404);
    if (!library.films[imdbId]) throw httpError('Film not found', 404);
    if (!list.filmIds.includes(imdbId)) list.filmIds.push(imdbId);
    return list;
}

function removeFilmFromList(library, listId, imdbId) {
    const list = library.lists.find((item) => item.id === listId);
    if (!list) throw httpError('List not found', 404);
    list.filmIds = list.filmIds.filter((id) => id !== imdbId);
    return list;
}

function addView(library, name, filters) {
    const trimmed = String(name || '').trim();
    if (!trimmed) throw httpError('View name is required', 400);
    const view = {
        id: createId(),
        name: trimmed.slice(0, 80),
        filters: cleanFilters(filters),
    };
    library.views.push(view);
    return view;
}

function deleteView(library, id) {
    library.views = library.views.filter((item) => item.id !== id);
}

function updateSettings(library, input) {
    if (input.country && /^[A-Z]{2}$/.test(input.country)) library.settings.country = input.country;
    if (typeof input.hideViewed === 'boolean') library.settings.hideViewed = input.hideViewed;
    return library.settings;
}

module.exports = {
    cleanFilters,
    upsertFilm,
    setStatus,
    setViewedAt,
    setReview,
    clearReview,
    removeFilm,
    addList,
    renameList,
    deleteList,
    reorderLists,
    addFilmToList,
    removeFilmFromList,
    addView,
    deleteView,
    updateSettings,
};
