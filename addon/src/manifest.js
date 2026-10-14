const { addonBuilder } = require('stremio-addon-sdk');
const { filmsForShelf, genreOptions, shelfMetas } = require('./catalog');

const ADDON_ID = 'com.streamlol.shelves';
const VERSION = '0.2.0';

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
    const shelves = [
        ['library', 'Library'],
        ['viewed', 'Viewed'],
        ['reviewed', 'Reviewed'],
        ...[...library.lists]
            .sort((a, b) => (a.order || 0) - (b.order || 0))
            .map((list) => [`list_${list.id}`, String(list.name || 'List').slice(0, 60)]),
    ];

    const shelfCatalogs = shelves.flatMap(([id, name]) => ['movie', 'series'].map((type) => {
        const films = filmsForShelf(library, id, type) || [];
        const fixed = !id.startsWith('list_');
        if (type === 'series' && !films.length) return null;
        if (type === 'movie' && !fixed && !films.length && (filmsForShelf(library, id, 'series') || []).length) return null;
        return { type, id, name, extra: extraFor(films) };
    })).filter(Boolean);

    const views = library.views.map((view) => ({
        type: view.filters && view.filters.type === 'series' ? 'series' : 'movie',
        id: `view_${view.id}`,
        name: String(view.name || 'View').slice(0, 60),
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
        version: VERSION,
        name: 'Streamlol Shelves',
        description: 'Personal movie and series shelves, lists, reviews, and combined discovery filters.',
        resources: ['catalog'],
        types: ['movie', 'series'],
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
    manifestFor,
    createInterface,
};
