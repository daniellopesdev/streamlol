const { tmdb } = require('./tmdb');

const KINDS = ['person', 'company', 'keyword', 'collection', 'list'];
const POOL_MS = 12 * 60 * 60 * 1000;
const LIST_PAGE_CONCURRENCY = 6;
const MAX_LIST_PAGES = 120;

// TMDB has no list search, so well-known curated lists are matched by alias.
const CURATED = [
    {
        id: 'criterion',
        listId: 8649108,
        name: 'The Criterion Collection',
        description: 'Every film released in the Criterion Collection, by spine number.',
        aliases: ['criterion', 'criterion collection', 'cc', 'spine'],
        movieOnly: true,
    },
];

const poolCache = new Map();

function curated(id) {
    return CURATED.find((item) => item.id === id) || null;
}

function cleanScope(input) {
    if (!input) return null;
    let raw = input;
    if (typeof input === 'string') {
        try {
            raw = JSON.parse(input);
        } catch {
            const [kind, id, role] = input.split(':');
            raw = { kind, id, role };
        }
    }
    if (!raw || typeof raw !== 'object' || !KINDS.includes(raw.kind)) return null;
    const id = String(raw.id || '');
    const valid = raw.kind === 'list' ? (curated(id) || /^\d{1,10}$/.test(id)) : /^\d{1,10}$/.test(id);
    if (!valid) return null;
    const scope = {
        kind: raw.kind,
        id,
        name: String(raw.name || (curated(id) && curated(id).name) || '').slice(0, 120),
    };
    if (raw.kind === 'person') scope.role = raw.role === 'crew' ? 'crew' : 'cast';
    return scope;
}

function scopeLabel(scope, type) {
    if (!scope) return '';
    if (scope.kind === 'person') {
        if (scope.role === 'crew') return `${type === 'series' ? 'Created by' : 'Directed by'} ${scope.name}`;
        return `With ${scope.name}`;
    }
    return scope.name;
}

function movieOnly(scope) {
    if (!scope) return false;
    if (scope.kind === 'collection') return true;
    if (scope.kind === 'list') return Boolean(curated(scope.id)?.movieOnly);
    return false;
}

// Company and keyword scopes map straight onto /discover; the rest are pooled locally.
function scopeParams(scope) {
    if (!scope) return {};
    if (scope.kind === 'company') return { with_companies: scope.id };
    if (scope.kind === 'keyword') return { with_keywords: scope.id };
    return {};
}

function isPooled(scope) {
    return Boolean(scope) && ['person', 'collection', 'list'].includes(scope.kind);
}

async function personCredits(credential, type, personId, role) {
    const credits = await tmdb(credential, `/person/${personId}/${type === 'series' ? 'tv_credits' : 'movie_credits'}`);
    if (role === 'crew') {
        const jobs = type === 'series' ? ['Creator'] : ['Director'];
        return (credits.crew || []).filter((item) => jobs.includes(item.job));
    }
    return (credits.cast || []).filter((item) => type !== 'series' || (item.episode_count || 0) >= 3);
}

async function listItems(credential, listId) {
    const first = await tmdb(credential, `/list/${listId}`, { page: 1 });
    const total = Math.min(first.total_pages || 1, MAX_LIST_PAGES);
    const pages = [];
    for (let page = 2; page <= total; page += 1) pages.push(page);
    const rest = [];
    let cursor = 0;
    async function run() {
        while (cursor < pages.length) {
            const page = pages[cursor];
            cursor += 1;
            const payload = await tmdb(credential, `/list/${listId}`, { page }).catch(() => ({ items: [] }));
            rest.push({ page, items: payload.items || [] });
        }
    }
    await Promise.all(Array.from({ length: Math.min(LIST_PAGE_CONCURRENCY, pages.length) }, run));
    rest.sort((a, b) => a.page - b.page);
    return {
        name: first.name,
        items: [...(first.items || []), ...rest.flatMap((entry) => entry.items)],
    };
}

async function loadPool(credential, scope, type) {
    if (scope.kind === 'person') return personCredits(credential, type, scope.id, scope.role);
    if (scope.kind === 'collection') {
        const payload = await tmdb(credential, `/collection/${scope.id}`);
        return payload.parts || [];
    }
    const listId = curated(scope.id)?.listId || scope.id;
    const { items } = await listItems(credential, listId);
    const media = type === 'series' ? 'tv' : 'movie';
    return items.filter((item) => (item.media_type || 'movie') === media);
}

function scopePool(credential, scope, type) {
    const key = `${scope.kind}:${scope.id}:${scope.role || ''}:${type}`;
    const hit = poolCache.get(key);
    if (hit && Date.now() - hit.at < POOL_MS) return hit.value;
    const value = loadPool(credential, scope, type).then((items) => {
        const seen = new Set();
        return items.filter((item, index) => {
            if (!item || seen.has(item.id)) return false;
            seen.add(item.id);
            item.listOrder = index;
            return true;
        });
    });
    poolCache.set(key, { at: Date.now(), value });
    value.catch(() => poolCache.delete(key));
    return value;
}

function image(path, size) {
    return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

async function listByUrl(credential, q) {
    const match = /themoviedb\.org\/list\/(\d+)/i.exec(q) || /^list:(\d+)$/i.exec(q);
    if (!match) return null;
    const payload = await tmdb(credential, `/list/${match[1]}`, { page: 1 }).catch(() => null);
    if (!payload) return null;
    return {
        kind: 'list',
        id: match[1],
        name: payload.name || `TMDB list ${match[1]}`,
        description: `${payload.item_count || 0} titles`,
    };
}

async function searchScopes(credential, query, type) {
    const q = String(query || '').trim().slice(0, 120);
    if (q.length < 2) return { people: [], lists: [], collections: [], companies: [], keywords: [] };
    const lower = q.toLowerCase();
    const lists = CURATED
        .filter((item) => item.name.toLowerCase().includes(lower) || item.aliases.some((alias) => lower.includes(alias) || alias.startsWith(lower)))
        .map((item) => ({ kind: 'list', id: item.id, name: item.name, description: item.description, movieOnly: item.movieOnly }));
    const empty = { results: [] };
    const [byUrl, people, companies, keywords, collections] = await Promise.all([
        listByUrl(credential, q),
        tmdb(credential, '/search/person', { query: q, include_adult: false }).catch(() => empty),
        tmdb(credential, '/search/company', { query: q }).catch(() => empty),
        tmdb(credential, '/search/keyword', { query: q }).catch(() => empty),
        type === 'series' ? empty : tmdb(credential, '/search/collection', { query: q }).catch(() => empty),
    ]);
    if (byUrl) lists.unshift(byUrl);
    return {
        lists,
        people: (people.results || []).slice(0, 6).map((person) => ({
            kind: 'person',
            id: String(person.id),
            name: person.name,
            photo: image(person.profile_path, 'w185'),
            department: person.known_for_department || '',
            role: ['Directing', 'Creator'].includes(person.known_for_department) ? 'crew' : 'cast',
            knownFor: (person.known_for || []).map((item) => item.title || item.name).filter(Boolean).slice(0, 3),
        })),
        collections: (collections.results || []).slice(0, 4).map((item) => ({
            kind: 'collection',
            id: String(item.id),
            name: item.name,
            photo: image(item.poster_path, 'w185'),
        })),
        companies: (companies.results || []).slice(0, 4).map((item) => ({
            kind: 'company',
            id: String(item.id),
            name: item.name,
            photo: image(item.logo_path, 'w185'),
            description: item.origin_country || '',
        })),
        keywords: (keywords.results || []).slice(0, 5).map((item) => ({
            kind: 'keyword',
            id: String(item.id),
            name: item.name,
        })),
    };
}

module.exports = {
    CURATED,
    cleanScope,
    scopeLabel,
    scopeParams,
    scopePool,
    isPooled,
    movieOnly,
    personCredits,
    searchScopes,
};
