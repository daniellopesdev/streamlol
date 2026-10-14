const ADDON_ID = 'com.streamlol.shelves';
const STORAGE_KEY = 'streamlol.transportUrl';
const DESKTOP_CONFIG = '/__streamlol__/config.json';

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

function storedTransport() {
    try {
        return window.localStorage.getItem(STORAGE_KEY) || '';
    } catch {
        return '';
    }
}

function connectionFor(profile) {
    const installed = (profile.addons || []).find((addon) => addon.manifest && addon.manifest.id === ADDON_ID);
    const fromProfile = installed ? connectionFromTransport(installed.transportUrl) : null;
    if (fromProfile) return fromProfile;
    return connectionFromTransport(storedTransport());
}

function rememberTransport(transportUrl) {
    try {
        if (transportUrl) window.localStorage.setItem(STORAGE_KEY, transportUrl);
        else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
        // ignore quota / private mode
    }
    // Desktop shell also keeps a copy in Electron userData so reconnects survive restarts.
    fetch(DESKTOP_CONFIG, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transportUrl: transportUrl || '' }),
    }).catch(() => null);
}

async function restoreTransport() {
    const local = storedTransport();
    if (local) return local;
    try {
        const response = await fetch(DESKTOP_CONFIG, { cache: 'no-store' });
        if (!response.ok) return '';
        const payload = await response.json();
        if (payload && payload.transportUrl) {
            try {
                window.localStorage.setItem(STORAGE_KEY, payload.transportUrl);
            } catch {
                // ignore
            }
            return payload.transportUrl;
        }
    } catch {
        // Browser / webpack-dev without desktop config endpoint.
    }
    return '';
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
    restoreTransport,
    request,
};
