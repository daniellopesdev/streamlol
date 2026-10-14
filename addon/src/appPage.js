const fs = require('fs');
const path = require('path');
const { adsConfig } = require('./ads');

const INDEX = path.join(__dirname, '..', 'public', 'shelves', 'index.html');

function escapeJson(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c');
}

function appPage({ token, manifestUrl, installUrl, tmdb, origin }) {
    const html = fs.readFileSync(INDEX, 'utf8');
    const boot = {
        token,
        origin,
        apiBase: `${origin}/api/${token}`,
        manifestUrl,
        installUrl,
        tmdb: tmdb || null,
        ads: adsConfig(),
    };
    return html.replace(
        '/*__STREAMLOL_BOOT__*/',
        `window.__STREAMLOL__ = ${escapeJson(boot)};`
    );
}

module.exports = { appPage };
