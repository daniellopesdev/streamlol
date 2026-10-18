const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Optional browser regression: set NODE_PATH to a Playwright installation.
let chromium;
try { ({ chromium } = require('playwright')); } catch { /* Regular addon tests need no browser dependency. */ }

test('film saves keep the modal open and Discover searches survive selection and media switches', {
    skip: !chromium && 'Playwright is required for the browser regression',
}, async (t) => {
    const browser = await chromium.launch({ headless: true, ...(process.env.UI_BROWSER_CHANNEL ? { channel: process.env.UI_BROWSER_CHANNEL } : {}) });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const token = 'a'.repeat(24);
    const origin = 'http://streamlol.test';
    const root = path.join(__dirname, '..', 'public', 'shelves');
    const film = { imdbId: 'tt1234567', title: 'Test title', type: 'movie', genres: [] };
    const library = { films: {}, status: {}, reviews: {}, lists: [], settings: { tmdb: 'user', country: 'US' } };
    const requests = [];
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const boot = { token, origin, apiBase: `${origin}/api/${token}`, tmdb: 'user', ads: {}, manifestUrl: `${origin}/${token}/manifest.json` };
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace('/*__STREAMLOL_BOOT__*/', `window.__STREAMLOL__ = ${JSON.stringify(boot)};`);
    let releaseSlow;
    await page.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname === `/${token}/`) return route.fulfill({ contentType: 'text/html', body: html });
        if (url.pathname.startsWith('/shelves/')) {
            const file = path.basename(url.pathname);
            return route.fulfill({ path: path.join(root, file), contentType: file.endsWith('.js') ? 'text/javascript' : 'text/css' });
        }
        const endpoint = url.pathname.replace(`/api/${token}`, '');
        requests.push({ endpoint, params: Object.fromEntries(url.searchParams), method: request.method() });
        const json = (payload) => route.fulfill({ json: payload });
        if (!endpoint) return json(library);
        if (endpoint === '/stremio/device') return json({ saved: false });
        if (endpoint === '/reference') return json({ countries: [], genres: [], providers: [] });
        if (endpoint === '/search') return json({ people: [{ kind: 'person', id: '12', name: 'Test Person', role: 'cast', department: 'Acting', knownFor: [] }] });
        if (endpoint === '/discover') {
            if (url.searchParams.get('q') === 'slow' && url.searchParams.get('type') === 'movie') {
                await new Promise((resolve) => { releaseSlow = resolve; });
                return json({ results: [{ ...film, title: 'Stale movie' }] });
            }
            return json({ results: [{ ...film, type: url.searchParams.get('type') || 'movie' }], nextCursor: null });
        }
        if (endpoint.startsWith('/details/')) return json(film);
        if (endpoint.startsWith('/suggestions/')) return json({ rows: [] });
        if (endpoint === '/films') {
            const body = request.postDataJSON();
            library.films[body.imdbId] = body;
            library.status[body.imdbId] = body.status || 'library';
            return json(body);
        }
        if (endpoint.endsWith('/status')) {
            library.status[film.imdbId] = request.postDataJSON().status;
            return json(library.films[film.imdbId]);
        }
        if (endpoint.endsWith('/review')) {
            library.reviews[film.imdbId] = request.postDataJSON();
            library.status[film.imdbId] = 'viewed';
            return json(library.reviews[film.imdbId]);
        }
        throw new Error(`Unexpected UI request: ${endpoint}`);
    });
    await page.goto(`${origin}/${token}/`);
    await page.locator('.card').first().click();
    await page.getByRole('button', { name: '+ Library', exact: true }).waitFor();
    const modal = await page.locator('.modal.film').elementHandle();
    await modal.evaluate((node) => { node.scrollTop = 50; });
    await page.getByRole('button', { name: '+ Library', exact: true }).click();
    await page.getByRole('button', { name: 'Remove', exact: true }).waitFor();
    assert.equal(await modal.evaluate((node) => node.isConnected), true);
    await page.getByRole('button', { name: '✓ Mark viewed', exact: true }).click();
    await page.getByRole('button', { name: '✓ Viewed', exact: true }).waitFor();
    assert.equal(await modal.evaluate((node) => node.isConnected), true);
    await page.getByRole('button', { name: '✓ Viewed', exact: true }).click();
    await page.getByRole('button', { name: '✓ Mark viewed', exact: true }).waitFor();
    await page.locator('.scores').getByRole('button', { name: '8', exact: true }).click();
    await page.locator('.scores .on').waitFor();
    assert.equal(await modal.evaluate((node) => node.isConnected), true);
    assert.equal(requests.filter((item) => item.endpoint.startsWith('/details/') || item.endpoint.startsWith('/suggestions/')).length, 2);
    await page.getByRole('button', { name: 'Close', exact: true }).click();

    const input = () => page.locator('#command-input');
    await input().fill('Person');
    await page.locator('.sp-person .sp-text').click();
    await page.locator('.scope-name').waitFor();
    await input().fill('Batman');
    await page.getByRole('button', { name: /Titles matching/ }).click();
    await page.locator('.card').first().waitFor();
    assert.equal(await page.locator('.scope').count(), 0, 'title searches clear the selected person scope');
    assert.equal(requests.filter((item) => item.endpoint === '/discover').at(-1).params.q, 'Batman');
    await page.getByRole('button', { name: 'Series', exact: true }).click();
    await page.locator('.card').first().waitFor();
    assert.equal(await input().inputValue(), 'Batman');
    assert.equal(requests.filter((item) => item.endpoint === '/discover').at(-1).params.type, 'series');
    await input().fill('Unsubmitted title');
    await page.getByRole('button', { name: 'Movies', exact: true }).click();
    await page.locator('.card').first().waitFor();
    assert.equal(requests.filter((item) => item.endpoint === '/discover').at(-1).params.q, 'Unsubmitted title');

    await input().fill('slow');
    const slowRequest = page.waitForRequest((request) => new URL(request.url()).searchParams.get('q') === 'slow' && request.url().includes('/discover?'));
    await input().press('Enter');
    await slowRequest;
    await page.getByRole('button', { name: 'Series', exact: true }).click();
    await page.locator('.card').first().waitFor();
    const slowResponse = page.waitForResponse((response) => response.url().includes('type=movie') && response.url().includes('q=slow'));
    releaseSlow();
    await slowResponse;
    assert.equal(await page.locator('.card-title').first().textContent(), 'Test title');
    assert.deepEqual(errors, []);
});
