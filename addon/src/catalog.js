const PAGE_SIZE = 100;

const SORTS = ['added', 'title', 'year', 'imdb', 'score', 'recent'];

function toMeta(film, review) {
    const lines = [];
    if (review) {
        lines.push(`Your score: ${review.score}/10`);
        if (review.note) lines.push(review.note);
    }
    if (film.platforms && film.platforms.length) lines.push(film.platforms.join(', '));
    if (film.description) lines.push(film.description);
    return {
        id: film.imdbId,
        type: film.type === 'series' ? 'series' : 'movie',
        name: film.title,
        poster: film.poster || undefined,
        posterShape: 'poster',
        year: film.year || undefined,
        imdbRating: film.imdbRating || undefined,
        genres: film.genres || [],
        description: lines.join('\n') || undefined,
    };
}

function typeMatches(film, type) {
    return !type || (film.type || 'movie') === type;
}

function filmsForShelf(library, shelfId, type) {
    const films = Object.values(library.films).filter((film) => typeMatches(film, type));
    if (shelfId === 'library') {
        return films.filter((film) => library.status[film.imdbId] === 'library');
    }
    if (shelfId === 'viewed') {
        return films.filter((film) => library.status[film.imdbId] === 'viewed');
    }
    if (shelfId === 'reviewed') {
        return films.filter((film) => library.reviews[film.imdbId]);
    }
    if (shelfId.startsWith('list_')) {
        const list = library.lists.find((item) => item.id === shelfId.slice(5));
        if (!list) return [];
        return list.filmIds.map((id) => library.films[id]).filter((film) => film && typeMatches(film, type));
    }
    return null;
}

function filterFilms(films, { q, genre, platform } = {}) {
    const query = (q || '').trim().toLowerCase();
    return films.filter((film) => {
        if (query && !(film.title || '').toLowerCase().includes(query)) return false;
        if (genre && !(film.genres || []).includes(genre)) return false;
        if (platform && !(film.platforms || []).includes(platform)) return false;
        return true;
    });
}

function sortFilms(films, sort, library) {
    const copy = films.slice();
    const number = (value) => {
        const parsed = parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
    };
    copy.sort((a, b) => {
        if (sort === 'title') return (a.title || '').localeCompare(b.title || '');
        if (sort === 'year') return (b.year || '').localeCompare(a.year || '');
        if (sort === 'imdb') return number(b.imdbRating) - number(a.imdbRating);
        if (sort === 'score') return number(library.reviews[b.imdbId]?.score) - number(library.reviews[a.imdbId]?.score);
        if (sort === 'recent') return (b.viewedAt || 0) - (a.viewedAt || 0);
        return (b.addedAt || 0) - (a.addedAt || 0);
    });
    return copy;
}

function defaultSort(shelfId) {
    if (shelfId === 'viewed') return 'recent';
    if (shelfId === 'reviewed') return 'score';
    return 'added';
}

function shelfMetas(library, shelfId, extra = {}, type) {
    let films = filmsForShelf(library, shelfId, type);
    if (!films) return null;
    if (shelfId.startsWith('list_') && library.settings?.hideViewed !== false) {
        films = films.filter((film) => library.status[film.imdbId] !== 'viewed');
    }
    const sort = SORTS.includes(extra.sort) ? extra.sort : defaultSort(shelfId);
    const filtered = filterFilms(films, extra);
    const sorted = sortFilms(filtered, sort, library);
    const skip = Math.max(0, Number(extra.skip) || 0);
    return sorted.slice(skip, skip + PAGE_SIZE).map((film) => toMeta(film, library.reviews[film.imdbId]));
}

function genreOptions(films) {
    return [...new Set(films.flatMap((film) => film.genres || []))].sort().slice(0, 40);
}

module.exports = {
    PAGE_SIZE,
    SORTS,
    toMeta,
    filmsForShelf,
    filterFilms,
    sortFilms,
    shelfMetas,
    genreOptions,
};
