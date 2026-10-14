const ADDON_ID = 'com.streamlol.shelves';
const STORAGE_KEY = 'streamlol.transportUrl';

function connectionFromTransport(transportUrl) {
    try {
        const url = new URL(transportUrl);
        const [token, file] = url.pathname.split('/').filter(Boolean);
        if (!/^[a-f0-9]{24}$/.test(token) || file !== 'manifest.json') return null;
        return { origin: url.origin, token, transportUrl: url.toString() };
    } catch {
        return null;
    }
}

function connectionFor(profile) {
    const installed = (profile.addons || []).find((addon) => addon.manifest && addon.manifest.id === ADDON_ID);
    const fromProfile = installed ? connectionFromTransport(installed.transportUrl) : null;
    if (fromProfile) return fromProfile;
    try {
        return connectionFromTransport(window.localStorage.getItem(STORAGE_KEY) || '');
    } catch {
        return null;
    }
}

function rememberTransport(transportUrl) {
    if (transportUrl) {
        window.localStorage.setItem(STORAGE_KEY, transportUrl);
    } else {
        window.localStorage.removeItem(STORAGE_KEY);
    }
}

async function request(connection, path, options = {}) {
    const response = await fetch(`${connection.origin}/api/${connection.token}${path}`, {
        method: options.method || 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(payload.err || 'Request failed');
        error.code = payload.code;
        throw error;
    }
    return payload;
}

module.exports = {
    ADDON_ID,
    connectionFromTransport,
    connectionFor,
    rememberTransport,
    request,
};
