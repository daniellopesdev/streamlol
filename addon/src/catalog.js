const PAGE_SIZE = 100;

const SORTS = ['added', 'title', 'year', 'imdb', 'score', 'recent'];

function displayTitle(film) {
    let name = String(film.title || '').replace(/\s+/g, ' ').trim();
    if (!name || name === film.imdbId) return film.imdbId;
    // Scene-release names ("Movie.Name.1999.1080p…") read as gibberish on the Board.
    if (/[._](?:19|20)\d{2}[._]/.test(name) && (name.includes('.') || name.includes('_'))) {
        name = name.split(/[._](?:19|20)\d{2}[._]/)[0].replace(/[._]+/g, ' ').trim();
    }
    return name.slice(0, 120) || film.imdbId;
}

function releaseYear(film) {
    const fromField = String(film.year || '').match(/(?:19|20)\d{2}/);
    if (fromField) return fromField[0];
    const fromTitle = String(film.title || '').match(/[._\s]((?:19|20)\d{2})[._\s]/);
    return fromTitle ? fromTitle[1] : '';
}

function backdropFor(film) {
    if (typeof film.background === 'string' && film.background.startsWith('https://')) return film.background;
    if (/^tt\d+$/.test(film.imdbId || '')) {
        return `https://images.metahub.space/background/medium/${film.imdbId}/img`;
    }
    return undefined;
}

function toMeta(film, review) {
    const year = releaseYear(film);
    const bits = [];
    if (review) bits.push(`Your score: ${review.score}/10`);
    if (review && review.note) bits.push(String(review.note).replace(/\s+/g, ' ').trim());
    const plot = String(film.description || '').replace(/\s+/g, ' ').trim();
    if (plot) bits.push(plot);
    return {
        id: film.imdbId,
        type: film.type === 'series' ? 'series' : 'movie',
        name: displayTitle(film),
        poster: film.poster || undefined,
        posterShape: 'poster',
        background: backdropFor(film),
        logo: /^tt\d+$/.test(film.imdbId || '')
            ? `https://images.metahub.space/logo/medium/${film.imdbId}/img`
            : undefined,
        year: year || undefined,
        releaseInfo: year || undefined,
        imdbRating: film.imdbRating || undefined,
        genres: film.genres || [],
        description: bits.join(' · ').slice(0, 300) || undefined,
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
