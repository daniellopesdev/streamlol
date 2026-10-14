const crypto = require('crypto');
const { addonBuilder } = require('stremio-addon-sdk');
const { filmsForShelf, genreOptions, shelfMetas } = require('./catalog');

const ADDON_ID = 'com.streamlol.shelves';
const VERSION = '0.2.1';
const BOARD_PREFIX = 'Shelves';

// Content-hashed patch so Stremio refreshes Board catalogs after shelf edits
// without asking the user to uninstall/reinstall the addon.
function manifestVersion(library) {
    const sig = JSON.stringify({
        lists: (library.lists || []).map((list) => [list.id, list.name, (list.filmIds || []).length, list.order]),
        views: (library.views || []).map((view) => [view.id, view.name, view.filters]),
        films: Object.keys(library.films || {}).length,
        viewed: Object.values(library.status || {}).filter((status) => status === 'viewed').length,
        reviewed: Object.keys(library.reviews || {}).length,
    });
    const patch = parseInt(crypto.createHash('sha1').update(sig).digest('hex').slice(0, 6), 16);
    return `0.2.${patch}`;
}

function boardName(label) {
    const clean = String(label || 'List').trim().slice(0, 48);
    return `${BOARD_PREFIX} · ${clean}`;
}

function catalogExtra(films) {
    const extra = [
        { name: 'search', isRequired: false },
        { name: 'skip', isRequired: false },
    ];
    const genres = genreOptions(films);
    if (genres.length) {
        extra.push({ name: 'genre', isRequired: false, options: genres, optionsLimit: 1 });
    }
    return extra;
}

function catalogsFor(library, includeGenres) {
    const extraFor = (films) => (includeGenres ? catalogExtra(films) : [
        { name: 'search', isRequired: false },
        { name: 'skip', isRequired: false },
    ]);

    // Order is Board order: watch later → history → scores → custom lists → saved Discover rows.
    const shelves = [
        ['library', 'Library'],
        ['viewed', 'Viewed'],
        ['reviewed', 'Reviewed'],
        ...[...library.lists]
            .sort((a, b) => (a.order || 0) - (b.order || 0))
            .map((list) => [`list_${list.id}`, String(list.name || 'List').slice(0, 48)]),
    ];

    const shelfCatalogs = shelves.flatMap(([id, name]) => ['movie', 'series'].map((type) => {
        const films = filmsForShelf(library, id, type) || [];
        const fixed = !id.startsWith('list_');
        // Keep Board tidy: skip empty series rows; skip empty custom lists.
        if (type === 'series' && !films.length) return null;
        if (!fixed && !films.length) return null;
        // Always keep core movie shelves (even empty) so Board has stable entry points.
        if (type === 'movie' && fixed && !films.length) {
            return { type, id, name: boardName(name), extra: extraFor([]) };
        }
        return { type, id, name: boardName(name), extra: extraFor(films) };
    })).filter(Boolean);

    const views = library.views.map((view) => ({
        type: view.filters && view.filters.type === 'series' ? 'series' : 'movie',
        id: `view_${view.id}`,
        name: boardName(view.name || 'Saved row'),
        extra: [
            { name: 'search', isRequired: false },
            { name: 'skip', isRequired: false },
        ],
    }));

    return [...shelfCatalogs, ...views];
}

function buildManifest(library, includeGenres) {
    return {
        id: ADDON_ID,
        version: manifestVersion(library),
        name: 'Streamlol Shelves',
        description: 'Personal shelves on your Stremio Board: Library, Viewed, Reviewed, lists, and saved Discover filters.',
        resources: ['catalog'],
        types: ['movie', 'series'],
        idPrefixes: ['tt'],
        catalogs: catalogsFor(library, includeGenres),
        behaviorHints: {
            configurable: true,
            configurationRequired: false,
        },
    };
}

function manifestFor(library) {
    const withGenres = buildManifest(library, true);
    if (JSON.stringify(withGenres).length <= 7500) return withGenres;
    return buildManifest(library, false);
}

function createInterface(library, resolveView) {
    const builder = new addonBuilder(manifestFor(library));
    builder.defineCatalogHandler(async (args) => {
        if (args.type !== 'movie' && args.type !== 'series') return { metas: [] };
        if (typeof args.id === 'string' && args.id.startsWith('view_')) {
            const view = library.views.find((item) => item.id === args.id.slice(5));
            if (!view || (view.filters && view.filters.type === 'series' ? 'series' : 'movie') !== args.type) return { metas: [] };
            const skip = Math.max(0, Number(args.extra && args.extra.skip) || 0);
            return { metas: await resolveView(library, view, skip) };
        }
        const metas = shelfMetas(library, args.id, args.extra || {}, args.type);
        return { metas: metas || [] };
    });
    return builder.getInterface();
}

module.exports = {
    ADDON_ID,
    VERSION,
    BOARD_PREFIX,
    boardName,
    manifestFor,
    createInterface,
};
