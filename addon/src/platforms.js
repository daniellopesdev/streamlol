// Collapse TMDB's near-duplicate watch providers into one brand chip per service.
// TMDB keeps separate rows for ads / free / channel variants of the same storefront.

const SUFFIXES = [
    /\s+with Ads$/i,
    /\s+Free with Ads$/i,
    /\s+Free$/i,
    /\s+Amazon Channel$/i,
    /\s+Roku Premium Channel$/i,
    /\s+Apple TV Channel$/i,
];

const BRANDS = [
    { name: 'Prime Video', match: /^(amazon\s*)?(prime\s*video|amazon video|amazon mx player)/i },
    { name: 'Netflix', match: /^netflix/i },
    { name: 'Disney+', match: /^disney\+/i },
    { name: 'Max', match: /^(max|hbo\s*max|hbo)/i },
    { name: 'Hulu', match: /^hulu/i },
    { name: 'Apple TV', match: /^apple\s*tv/i },
    { name: 'Paramount+', match: /^paramount\+/i },
    { name: 'Peacock', match: /^peacock/i },
    { name: 'YouTube', match: /^youtube/i },
    { name: 'Google Play', match: /^(google play|google movies)/i },
    { name: 'Microsoft Store', match: /^(microsoft store|xbox)/i },
    { name: 'Vudu', match: /^(vudu|fandangonow)/i },
    { name: 'Crunchyroll', match: /^crunchyroll/i },
    { name: 'MUBI', match: /^mubi/i },
    { name: 'Curiosity Stream', match: /^curiosity/i },
    { name: 'Discovery+', match: /^discovery\+/i },
    { name: 'Starz', match: /^starz/i },
    { name: 'Showtime', match: /^showtime/i },
    { name: 'AMC+', match: /^amc\+/i },
    { name: 'BritBox', match: /^britbox/i },
    { name: 'iTunes', match: /^itunes/i },
    { name: 'Tubi', match: /^tubi/i },
    { name: 'Pluto TV', match: /^pluto/i },
    { name: 'Plex', match: /^plex/i },
    { name: 'Rakuten TV', match: /^rakuten/i },
    { name: 'Sky', match: /^sky\b/i },
    { name: 'Canal+', match: /^canal\+/i },
];

function stripSuffix(name) {
    let next = String(name || '').trim();
    for (const pattern of SUFFIXES) next = next.replace(pattern, '').trim();
    return next;
}

function brandName(raw) {
    const name = String(raw || '').trim();
    if (!name) return '';
    for (const brand of BRANDS) {
        if (brand.match.test(name) || brand.match.test(stripSuffix(name))) return brand.name;
    }
    return stripSuffix(name) || name;
}

function isVariant(name) {
    return /with Ads|Free with Ads|Amazon Channel|Roku Premium Channel|Apple TV Channel/i.test(name);
}

function collapseProviders(providers) {
    const groups = new Map();
    for (const item of providers || []) {
        const brand = brandName(item.name);
        if (!brand) continue;
        const id = String(item.id);
        let group = groups.get(brand);
        if (!group) {
            group = { name: brand, ids: [], candidates: [] };
            groups.set(brand, group);
        }
        if (!group.ids.includes(id)) group.ids.push(id);
        group.candidates.push(item);
    }

    return [...groups.values()].map((group) => {
        const preferred = group.candidates
            .slice()
            .sort((a, b) => {
                const variantDiff = Number(isVariant(a.name)) - Number(isVariant(b.name));
                if (variantDiff) return variantDiff;
                return (a.priority ?? 999) - (b.priority ?? 999);
            })[0];
        return {
            id: preferred.id,
            name: group.name,
            ids: group.ids,
            priority: preferred.priority ?? 999,
        };
    }).sort((a, b) => a.priority - b.priority);
}

function expandPlatformIds(selected, providers) {
    const wanted = new Set((selected || []).map(String));
    if (!wanted.size) return [];
    const expanded = new Set();
    for (const provider of providers || []) {
        const ids = (provider.ids || [provider.id]).map(String);
        if (ids.some((id) => wanted.has(id)) || wanted.has(String(provider.id))) {
            ids.forEach((id) => expanded.add(id));
        }
    }
    if (!expanded.size) return [...wanted];
    return [...expanded];
}

function brandNamesForIds(ids, providers) {
    const index = new Map();
    for (const provider of providers || []) {
        const name = provider.name;
        for (const id of (provider.ids || [provider.id]).map(String)) index.set(id, name);
    }
    return [...new Set((ids || []).map((id) => index.get(String(id)) || brandName(id)).filter(Boolean))];
}

module.exports = {
    brandName,
    collapseProviders,
    expandPlatformIds,
    brandNamesForIds,
};
