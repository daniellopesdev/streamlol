(() => {
    const boot = window.__STREAMLOL__;
    if (!boot || !boot.token) {
        document.getElementById('view').innerHTML = '<div class="empty">Missing library token. Open /configure to create one.</div>';
        return;
    }

    const THIS_YEAR = new Date().getFullYear();
    const SORTS = [['popular', 'Popular'], ['rating', 'Top rated'], ['newest', 'Newest'], ['votes', 'Most voted']];
    const IMDB_STEPS = [['', 'Any'], ['6', '6+'], ['7', '7+'], ['7.5', '7.5+'], ['8', '8+'], ['8.5', '8.5+']];
    const VOTE_STEPS = [['', 'Any'], ['100', '100+'], ['1000', '1k+'], ['10000', '10k+'], ['50000', '50k+']];
    const DECADES = [
        ['2020s', '2020', ''], ['2010s', '2010', '2019'], ['2000s', '2000', '2009'], ['90s', '1990', '1999'],
        ['80s', '1980', '1989'], ['70s', '1970', '1979'], ['60s', '1960', '1969'], ['Classic', '', '1959'],
    ];
    const KIND_LABEL = { person: 'Person', list: 'Collection', collection: 'Franchise', company: 'Studio', keyword: 'Theme' };

    function blankFilters(keep = {}) {
        return {
            q: '', sort: 'popular', genres: [], excludeGenres: [], yearFrom: '', yearTo: '',
            minImdb: '', minVotes: '', platforms: [], country: 'US', hideViewed: true, scope: null,
            ...keep,
        };
    }

    const state = {
        library: null,
        reference: { source: null, genres: [], providers: [], countries: [] },
        active: { kind: 'discover' },
        type: 'movie',
        filtersOpen: false,
        draft: null,
        deviceSession: null,
        allPlatforms: false,
        listsOpen: false,
        filters: blankFilters(),
        shelf: { q: '', sort: 'added' },
        results: [],
        scopeInfo: null,
        nextCursor: null,
        loading: false,
        notice: null,
        error: '',
        stack: [],
        requestId: 0,
        commandQuery: '',
    };

    const view = document.getElementById('view');
    const tabs = document.getElementById('main-tabs');
    const modalRoot = document.getElementById('modal-root');
    const installLink = document.getElementById('install-link');
    const settingsBtn = document.getElementById('btn-settings');

    installLink.href = boot.installUrl || boot.manifestUrl;
    settingsBtn.hidden = false;

    const TOKEN_KEY = 'streamlol_token';
    try { localStorage.setItem(TOKEN_KEY, boot.token); } catch { /* private mode */ }

    function forgetDevice() {
        try { localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
    }

    async function api(path, options = {}) {
        const response = await fetch(`${boot.apiBase}${path}`, {
            method: options.method || 'GET',
            signal: options.signal,
            headers: { 'Content-Type': 'application/json' },
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.err || 'Request failed');
        return payload;
    }

    function hasTmdb() {
        return Boolean(boot.tmdb || (state.library && state.library.settings && state.library.settings.tmdb));
    }

    function el(html) {
        const template = document.createElement('template');
        template.innerHTML = html.trim();
        return template.content.firstElementChild;
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        })[char]);
    }

    function button(label, className = '', onClick = null) {
        const node = el(`<button type="button" class="${className}">${label}</button>`);
        if (onClick) node.onclick = onClick;
        return node;
    }

    function typeOf(film) {
        return film && film.type === 'series' ? 'series' : 'movie';
    }

    function scopeTitle(scope) {
        if (!scope) return '';
        if (scope.kind === 'person') {
            if (scope.role === 'crew') return `${state.type === 'series' ? 'Created by' : 'Directed by'} ${scope.name}`;
            return `Starring ${scope.name}`;
        }
        return scope.name;
    }

    function scopeKindLabel(scope) {
        if (!scope) return '';
        if (scope.kind === 'person') return scope.role === 'crew' ? (state.type === 'series' ? 'Creator' : 'Director') : 'Actor';
        return KIND_LABEL[scope.kind] || scope.kind;
    }

    function scopeHasOrder(scope) {
        return Boolean(scope) && (scope.kind === 'list' || scope.kind === 'collection');
    }

    // ---------- library shelves ----------

    function shelfFilms() {
        const lib = state.library;
        if (!lib) return [];
        const films = Object.values(lib.films || {}).filter((film) => typeOf(film) === state.type);
        if (state.active.kind === 'library') return films.filter((film) => lib.status[film.imdbId] === 'library');
        if (state.active.kind === 'viewed') return films.filter((film) => lib.status[film.imdbId] === 'viewed');
        if (state.active.kind === 'reviewed') return films.filter((film) => lib.reviews[film.imdbId]);
        const list = (lib.lists || []).find((item) => item.id === state.active.id);
        if (!list) return [];
        return list.filmIds.map((id) => lib.films[id]).filter((film) => film && typeOf(film) === state.type);
    }

    function sortShelf(films) {
        const number = (value) => {
            const parsed = parseFloat(value);
            return Number.isFinite(parsed) ? parsed : 0;
        };
        const sort = state.shelf.sort;
        return films.slice().sort((a, b) => {
            if (sort === 'title') return (a.title || '').localeCompare(b.title || '');
            if (sort === 'year') return (b.year || '').localeCompare(a.year || '');
            if (sort === 'imdb') return number(b.imdbRating) - number(a.imdbRating);
            if (sort === 'score') return number(state.library.reviews[b.imdbId]?.score) - number(state.library.reviews[a.imdbId]?.score);
            if (sort === 'recent') return (b.viewedAt || b.addedAt || 0) - (a.viewedAt || a.addedAt || 0);
            return (b.addedAt || 0) - (a.addedAt || 0);
        });
    }

    function calendarGroups(films) {
        const groups = [];
        films.forEach((film) => {
            const date = new Date(film.viewedAt || film.addedAt || Date.now());
            const key = `${date.getFullYear()}-${date.getMonth()}`;
            let group = groups[groups.length - 1];
            if (!group || group.key !== key) {
                group = { key, label: date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), films: [] };
                groups.push(group);
            }
            group.films.push(film);
        });
        return groups;
    }

    // ---------- data ----------

    async function reload() {
        state.library = await api('');
        boot.tmdb = state.library.settings.tmdb || null;
        return state.library;
    }

    async function loadReference(country = state.draft?.country || state.filters.country || state.library?.settings?.country || 'US') {
        const type = state.type;
        const reference = await api(`/reference?country=${encodeURIComponent(country)}&type=${type}`);
        if (type === state.type && country === (state.draft?.country || state.filters.country || state.library?.settings?.country || 'US')) state.reference = reference;
    }

    function discoverParams() {
        const f = state.filters;
        const params = new URLSearchParams({
            q: f.q || '',
            type: state.type,
            sort: f.sort || 'popular',
            genres: f.genres.join(','),
            excludeGenres: f.excludeGenres.join(','),
            yearFrom: f.yearFrom || '',
            yearTo: f.yearTo || '',
            minImdb: f.minImdb || '',
            minVotes: f.minVotes || '',
            platforms: f.platforms.join(','),
            country: f.country || 'US',
            hideViewed: f.hideViewed === false ? 'false' : 'true',
        });
        if (f.scope) params.set('scope', JSON.stringify(f.scope));
        return params;
    }

    async function search(cursor = null) {
        clearTimeout(searchTimer);
        searchController?.abort();
        const controller = new AbortController();
        searchController = controller;
        const requestId = ++state.requestId;
        state.loading = true;
        state.error = '';
        if (!cursor) {
            state.results = [];
            state.nextCursor = null;
            state.scopeInfo = null;
            state.notice = null;
        }
        render();
        try {
            const params = discoverParams();
            if (cursor) params.set('cursor', cursor);
            const payload = await api(`/discover?${params}`, { signal: controller.signal });
            if (requestId !== state.requestId) return;
            state.results = cursor ? [...state.results, ...payload.results] : payload.results;
            state.nextCursor = payload.nextCursor || null;
            state.notice = payload.notice || null;
            state.scopeInfo = payload.scope || null;
        } catch (error) {
            if (requestId !== state.requestId) return;
            state.error = error.message;
            if (!cursor) state.results = [];
        } finally {
            if (requestId === state.requestId) {
                state.loading = false;
                render();
            }
        }
    }

    let searchTimer = null;
    let searchController = null;
    function scheduleSearch() {
        clearTimeout(searchTimer);
        searchController?.abort();
        state.requestId += 1;
        render();
        searchTimer = setTimeout(() => search(), 380);
    }

    async function applyScope(scope, options = {}) {
        clearTimeout(searchTimer);
        searchController?.abort();
        state.requestId += 1;
        state.commandQuery = '';
        const keep = {
            country: state.filters.country,
            hideViewed: state.filters.hideViewed,
            sort: options.sort || (scopeHasOrder(scope) ? 'list' : 'popular'),
        };
        state.filters = blankFilters({ ...keep, scope });
        state.active = { kind: 'discover' };
        state.listsOpen = false;
        const needsMovies = scope && (scope.kind === 'collection' || (scope.kind === 'list' && scope.movieOnly !== false && !/^\d+$/.test(scope.id)));
        if (needsMovies && state.type !== 'movie') {
            state.type = 'movie';
            await loadReference().catch(() => {});
        } else if (options.type && options.type !== state.type) {
            state.type = options.type;
            await loadReference().catch(() => {});
        }
        modalRoot.innerHTML = '';
        window.scrollTo({ top: 0, behavior: 'smooth' });
        await search();
    }

    function clearScope() {
        state.filters.scope = null;
        if (state.filters.sort === 'list') state.filters.sort = 'popular';
        search();
    }

    // ---------- ads ----------

    function setupAds() {
        const ads = boot.ads || {};
        const show = Boolean(ads.showPlaceholders || ads.live);
        document.getElementById('rail').hidden = !show;
        document.getElementById('layout').classList.toggle('has-rail', show);
        document.querySelectorAll('[data-ad]').forEach((node) => {
            const key = node.getAttribute('data-ad');
            node.hidden = !show;
            const frame = node.querySelector('.ad-frame');
            if (!frame || frame.dataset.ready) return;
            if (ads.live && ads.client && ads.slots && ads.slots[key]) {
                frame.innerHTML = '';
                const ins = document.createElement('ins');
                ins.className = 'adsbygoogle';
                ins.style.display = 'block';
                ins.dataset.adClient = ads.client;
                ins.dataset.adSlot = ads.slots[key];
                ins.dataset.adFormat = 'auto';
                ins.dataset.fullWidthResponsive = 'true';
                frame.appendChild(ins);
                frame.dataset.ready = '1';
            } else if (show) {
                frame.textContent = 'Ad space reserved';
            }
        });
        if (ads.live && ads.client && !document.getElementById('adsense-script')) {
            const script = document.createElement('script');
            script.id = 'adsense-script';
            script.async = true;
            script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ads.client)}`;
            script.crossOrigin = 'anonymous';
            document.head.appendChild(script);
            script.onload = () => {
                try {
                    document.querySelectorAll('ins.adsbygoogle').forEach(() => {
                        (window.adsbygoogle = window.adsbygoogle || []).push({});
                    });
                } catch {
                    // ignore
                }
            };
        }
    }

    // ---------- setup gate ----------

    function renderSetup() {
        tabs.hidden = true;
        view.innerHTML = '';
        const box = el(`
          <div class="onboard">
            <ol class="progress">
              <li class="done"><span>1</span>Library created</li>
              <li class="now"><span>2</span>Connect TMDB</li>
              <li><span>3</span>Install in Stremio</li>
            </ol>
            <div class="onboard-grid">
              <div class="onboard-main">
                <span class="eyebrow">Step 2 of 3</span>
                <h1>Connect The Movie Database</h1>
                <p class="lede">TMDB powers search, directors & cast, collections, platforms and suggestions. A personal key is free and takes a minute.</p>
                <form class="key-form" id="tmdb-form">
                  <input class="input grow mono" id="tmdb-input" type="password" autocomplete="off" spellcheck="false" placeholder="eyJhbGciOi…  or 32-character API key">
                  <button type="submit" class="btn primary" id="tmdb-save">Connect</button>
                </form>
                <p class="error" id="tmdb-error"></p>
                <p class="muted small">Stored with this library only — never shared, never shown again.</p>
              </div>
              <aside class="onboard-help">
                <div class="fsec-label">Get a key</div>
                <ol class="howto">
                  <li>Sign up at <a href="https://www.themoviedb.org/signup" target="_blank" rel="noopener">themoviedb.org</a></li>
                  <li>Go to <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener">Settings → API</a> and create a Developer key</li>
                  <li>Copy the <b>API Read Access Token</b> (or the API Key)</li>
                </ol>
                <a class="btn ghost sm" href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener">Open TMDB API settings ↗</a>
              </aside>
            </div>
            <div class="onboard-foot">
              <span class="muted small">This device will remember your library. Your private link:</span>
              <code class="mono small">${escapeHtml(location.origin)}/${escapeHtml(boot.token)}/</code>
            </div>
          </div>
        `);
        view.appendChild(box);
        const input = box.querySelector('#tmdb-input');
        input.focus();
        box.querySelector('#tmdb-form').onsubmit = async (event) => {
            event.preventDefault();
            const token = input.value.trim();
            const err = box.querySelector('#tmdb-error');
            const save = box.querySelector('#tmdb-save');
            if (!token) { err.textContent = 'Paste the token first.'; return; }
            err.textContent = '';
            save.disabled = true;
            save.textContent = 'Checking…';
            try {
                await api('/tmdb', { method: 'PUT', body: { token } });
                await reload();
                await loadReference();
                await search();
                showInstallPrompt();
            } catch (error) {
                err.textContent = error.message;
                save.disabled = false;
                save.textContent = 'Connect';
            }
        };
    }

    function addonInstalled() {
        if (state.library.stremio && state.library.stremio.addon && state.library.stremio.addon.installed) return true;
        return Boolean(state.deviceSession && state.deviceSession.addon && state.deviceSession.addon.installed);
    }

    function hasDeviceLogin() {
        return Boolean(state.deviceSession && state.deviceSession.saved);
    }

    function setInstallLink() {
        if (!installLink) return;
        if (addonInstalled()) {
            installLink.textContent = 'Update Shelves';
            installLink.href = '#';
            installLink.onclick = (event) => {
                event.preventDefault();
                updateShelves();
            };
        } else {
            installLink.textContent = 'Install in Stremio';
            installLink.href = boot.installUrl || boot.manifestUrl;
            installLink.onclick = null;
        }
    }

    // Already on Board → sync Stremio library into Shelves (never install a second addon).
    // Missing from Board → install via stremio:// or addFromURL once.
    async function updateShelves() {
        try {
            if (!state.library.stremio || state.library.stremio.error) {
                if (!hasDeviceLogin()) {
                    connectStremio();
                    return;
                }
                const payload = await api('/stremio', { method: 'POST', body: { device: true } });
                state.library = payload.library;
                state.deviceSession = {
                    saved: true,
                    email: state.library.stremio && state.library.stremio.email,
                    addon: payload.addon || (state.library.stremio && state.library.stremio.addon),
                };
                setInstallLink();
                const { added, viewed } = payload.result || {};
                toast(`Shelves updated · synced ${added || 0} titles${viewed ? ` · ${viewed} viewed` : ''}`);
                state.active = { kind: 'library' };
                render();
                return;
            }
            if (addonInstalled()) {
                const payload = await api('/stremio/sync', { method: 'POST' });
                state.library = payload.library;
                setInstallLink();
                toast(syncSummary(payload.result) || 'Shelves updated');
                render();
                return;
            }
            const payload = await api('/stremio/addon', { method: 'POST' });
            state.library = payload.library;
            if (state.deviceSession) state.deviceSession.addon = payload.addon;
            setInstallLink();
            toast(payload.addon && payload.addon.installed
                ? 'Shelves installed in Stremio — open the Board'
                : 'Could not install Shelves — try Install in Stremio');
            render();
        } catch (error) {
            toast(error.message);
        }
    }

    async function probeDeviceSession() {
        try {
            const device = await api('/stremio/device');
            state.deviceSession = device;
            if (device.addon && state.library.stremio) {
                state.library.stremio.addon = {
                    installed: Boolean(device.addon.installed),
                    transportUrl: device.addon.transportUrl || null,
                };
            }
            setInstallLink();
            return device;
        } catch {
            state.deviceSession = null;
            return null;
        }
    }

    function showInstallPrompt() {
        const installed = addonInstalled();
        const backdrop = el(`
          <div class="modal-backdrop">
            <div class="modal small onboard-done">
              <span class="eyebrow">Step 3 of 3</span>
              <h2>${installed ? 'TMDB connected. Shelves are in Stremio' : 'TMDB connected. Add Shelves to Stremio'}</h2>
              <p class="muted">${installed
            ? 'Your Board already has <b>Shelves · …</b> rows. Press <b>Update Shelves</b> to sync your Stremio library — no second install.'
            : 'Your library, lists and saved searches show up as <b>Shelves · …</b> rows on Stremio\'s Board and Discover — on every device, TV included.'}</p>
              <div class="row end">
                <button type="button" class="btn ghost" id="later">Later</button>
                ${!state.library.stremio && !installed ? '<button type="button" class="btn" id="import">Import my Stremio library</button>' : ''}
                ${installed
            ? '<button type="button" class="btn primary" id="update">Update Shelves</button>'
            : `<a class="btn primary" id="install" href="${escapeHtml(boot.installUrl || boot.manifestUrl)}">Install in Stremio</a>`}
              </div>
            </div>
          </div>
        `);
        modalRoot.appendChild(backdrop);
        const done = () => backdrop.remove();
        backdrop.querySelector('#later').onclick = done;
        const importBtn = backdrop.querySelector('#import');
        if (importBtn) importBtn.onclick = () => { done(); connectStremio(); };
        const install = backdrop.querySelector('#install');
        if (install) install.addEventListener('click', () => setTimeout(done, 300));
        const updateBtn = backdrop.querySelector('#update');
        if (updateBtn) updateBtn.onclick = async () => { await updateShelves(); done(); };
    }

    // ---------- cards ----------

    function filmCard(film, badgeText) {
        const poster = film.poster ? `<img src="${escapeHtml(film.poster)}" alt="" loading="lazy">` : '';
        const badge = badgeText ? `<div class="badge">${escapeHtml(badgeText)}</div>` : '';
        const viewed = state.library?.status?.[film.imdbId] === 'viewed' && state.active.kind === 'discover'
            ? '<div class="badge seen">Seen</div>' : '';
        const node = el(`
          <button type="button" class="card" title="${escapeHtml(film.title || '')}">
            <div class="poster">${poster}${badge}${viewed}</div>
            <div class="card-title">${escapeHtml(film.title || film.imdbId)}</div>
            <div class="card-sub">${escapeHtml(film.year || '')}</div>
          </button>
        `);
        node.onclick = () => openFilm(film);
        return node;
    }

    function renderGrid(films, into) {
        const grid = el('<div class="grid"></div>');
        films.forEach((film) => {
            let badge = film.imdbRating ? `★ ${film.imdbRating}` : '';
            if (state.active.kind === 'viewed') {
                const date = new Date(film.viewedAt || film.addedAt || Date.now());
                badge = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
            } else if (state.active.kind !== 'discover' && state.library?.reviews?.[film.imdbId]) {
                badge = `You ${state.library.reviews[film.imdbId].score}`;
            }
            grid.appendChild(filmCard(film, badge));
        });
        into.appendChild(grid);
    }

    // ---------- chrome ----------

    function renderTabs() {
        tabs.hidden = false;
        tabs.innerHTML = '';
        const items = [
            ['discover', 'Discover'],
            ['library', 'Library'],
            ['viewed', 'Viewed'],
            ['reviewed', 'Reviewed'],
            ['lists', 'Lists'],
        ];
        items.forEach(([kind, label]) => {
            const selected = kind === 'lists'
                ? (state.active.kind === 'list' || state.listsOpen)
                : state.active.kind === kind && !state.listsOpen;
            tabs.appendChild(button(label, `tab ${selected ? 'on' : ''}`, () => {
                if (kind === 'lists') {
                    state.listsOpen = !state.listsOpen;
                    if (!state.listsOpen && state.active.kind === 'list') state.active = { kind: 'library' };
                } else {
                    state.active = { kind };
                    state.listsOpen = false;
                    state.shelf = { q: '', sort: kind === 'viewed' ? 'recent' : kind === 'reviewed' ? 'score' : 'added' };
                    if (kind === 'discover' && !state.results.length) search();
                }
                render();
            }));
        });
    }

    function segmented(options, current, onPick, className = '') {
        const seg = el(`<div class="seg ${className}" role="tablist"></div>`);
        options.forEach(([id, label]) => {
            seg.appendChild(button(escapeHtml(label), `seg-item ${current === id ? 'on' : ''}`, () => onPick(id)));
        });
        return seg;
    }

    function renderMain() {
        view.innerHTML = '';

        const head = el('<div class="head"></div>');
        head.appendChild(segmented([['movie', 'Movies'], ['series', 'Series']], state.type, switchType));
        view.appendChild(head);

        if (state.listsOpen) {
            const row = el('<div class="chips lists-row"></div>');
            (state.library.lists || []).forEach((list) => {
                const on = state.active.kind === 'list' && state.active.id === list.id;
                row.appendChild(button(escapeHtml(list.name), `chip ${on ? 'on' : ''}`, () => { state.active = { kind: 'list', id: list.id }; render(); }));
            });
            row.appendChild(button('+ New list', 'chip add', () => createList()));
            view.appendChild(row);
        }

        if (state.active.kind !== 'discover') renderShelf();
        else if (!state.listsOpen) renderDiscover();
    }

    // ---------- command search ----------

    async function switchType(type) {
        if (type === state.type) return;
        state.type = type;
        state.filters = { ...state.filters, genres: [], excludeGenres: [], platforms: [] };
        if (state.commandQuery.trim() !== state.filters.q) {
            state.filters.q = state.commandQuery.trim();
            state.filters.scope = null;
        }
        if (state.filters.sort === 'list' && !scopeHasOrder(state.filters.scope)) state.filters.sort = 'popular';
        if (hasTmdb()) loadReference().catch(() => {});
        if (state.active.kind === 'discover') await search();
        else {
            searchController?.abort();
            state.requestId += 1;
            state.results = [];
            state.nextCursor = null;
            state.loading = false;
            render();
        }
    }

    function titleSearch(query) {
        state.commandQuery = query.trim();
        state.filters.q = state.commandQuery;
        state.filters.scope = null;
        if (state.filters.sort === 'list') state.filters.sort = 'popular';
        return search();
    }

    function commandBar() {
        const wrap = el(`
          <div class="command">
            <span class="command-icon" aria-hidden="true">⌕</span>
            <input class="command-input" id="command-input" autocomplete="off" spellcheck="false"
              placeholder="Search titles, directors, actors, collections — try “Nolan” or “Criterion”">
            <kbd class="command-kbd">/</kbd>
            <div class="suggest-panel" hidden></div>
          </div>
        `);
        const input = wrap.querySelector('input');
        const panel = wrap.querySelector('.suggest-panel');
        input.value = state.commandQuery;
        let timer = null;
        let lookupId = 0;

        const close = () => { clearTimeout(timer); lookupId += 1; panel.hidden = true; };
        const runTitleSearch = (query = input.value) => {
            close();
            titleSearch(typeof query === 'string' ? query : input.value);
        };

        const focusables = () => [...panel.querySelectorAll('button')];

        async function lookup(q) {
            const id = ++lookupId;
            const type = state.type;
            if (q.length < 2) { close(); return; }
            panel.hidden = false;
            panel.innerHTML = '<div class="sp-loading">Searching…</div>';
            let found;
            try {
                found = await api(`/search?q=${encodeURIComponent(q)}&type=${type}`);
            } catch (error) {
                if (id === lookupId && wrap.isConnected && type === state.type) {
                    renderSuggestPanel(panel, q, {}, runTitleSearch);
                }
                return;
            }
            if (id !== lookupId || !wrap.isConnected || type !== state.type) return;
            renderSuggestPanel(panel, q, found, runTitleSearch);
        }

        input.oninput = () => {
            clearTimeout(timer);
            const q = input.value.trim();
            state.commandQuery = input.value;
            lookupId += 1;
            panel.hidden = true;
            panel.innerHTML = '';
            timer = setTimeout(() => lookup(q), 260);
        };
        input.onkeydown = (event) => {
            if (event.key === 'Enter') { event.preventDefault(); runTitleSearch(); }
            if (event.key === 'Escape') close();
            if (event.key === 'ArrowDown' && !panel.hidden) {
                event.preventDefault();
                focusables()[0]?.focus();
            }
        };
        input.onfocus = () => { if (input.value.trim().length >= 2 && panel.innerHTML) panel.hidden = false; };
        panel.onkeydown = (event) => {
            const items = focusables();
            const index = items.indexOf(document.activeElement);
            if (event.key === 'ArrowDown') { event.preventDefault(); items[Math.min(index + 1, items.length - 1)]?.focus(); }
            if (event.key === 'ArrowUp') {
                event.preventDefault();
                if (index <= 0) input.focus();
                else items[index - 1].focus();
            }
            if (event.key === 'Escape') { close(); input.focus(); }
        };
        wrap.addEventListener('focusout', () => {
            setTimeout(() => { if (!wrap.contains(document.activeElement)) close(); }, 120);
        });
        return wrap;
    }

    function renderSuggestPanel(panel, q, found, runTitleSearch) {
        panel.innerHTML = '';
        const titleRow = el(`
          <button type="button" class="sp-item sp-title">
            <span class="sp-glyph">T</span>
            <span class="sp-text"><b>Titles matching “${escapeHtml(q)}”</b><small>${state.type === 'series' ? 'Series' : 'Movies'} · press Enter</small></span>
          </button>
        `);
        titleRow.onclick = () => runTitleSearch(q);
        panel.appendChild(titleRow);

        const group = (label, items, renderItem) => {
            if (!items || !items.length) return;
            panel.appendChild(el(`<div class="sp-group">${escapeHtml(label)}</div>`));
            items.forEach((item) => panel.appendChild(renderItem(item)));
        };

        const simple = (item, glyph, sub) => {
            const node = el(`
              <button type="button" class="sp-item">
                ${item.photo ? `<img class="sp-thumb ${item.kind === 'company' ? 'logo' : ''}" src="${escapeHtml(item.photo)}" alt="">` : `<span class="sp-glyph">${glyph}</span>`}
                <span class="sp-text"><b>${escapeHtml(item.name)}</b>${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</span>
                <span class="sp-kind">${escapeHtml(KIND_LABEL[item.kind] || '')}</span>
              </button>
            `);
            node.onclick = () => applyScope({ kind: item.kind, id: item.id, name: item.name, movieOnly: item.movieOnly });
            return node;
        };

        group('Collections', [...(found.lists || []), ...(found.collections || [])], (item) => simple(item, '◆', item.description || (item.kind === 'collection' ? 'Franchise' : '')));

        group('People', found.people, (person) => {
            const directing = person.role === 'crew';
            const crewLabel = state.type === 'series' ? 'Created by' : 'Directed by';
            const node = el(`
              <div class="sp-person">
                ${person.photo ? `<img class="sp-thumb round" src="${escapeHtml(person.photo)}" alt="">` : `<span class="sp-glyph round">${escapeHtml((person.name || '?').slice(0, 1))}</span>`}
                <span class="sp-text"><b>${escapeHtml(person.name)}</b><small>${escapeHtml([person.department, person.knownFor.join(', ')].filter(Boolean).join(' · '))}</small></span>
                <span class="sp-actions"></span>
              </div>
            `);
            const actions = node.querySelector('.sp-actions');
            node.querySelector('.sp-text').onclick = () => applyScope({ kind: 'person', id: person.id, name: person.name, role: person.role });
            const crew = button(crewLabel, `mini ${directing ? 'primary' : ''}`, () => applyScope({ kind: 'person', id: person.id, name: person.name, role: 'crew' }));
            const cast = button('Starring', `mini ${directing ? '' : 'primary'}`, () => applyScope({ kind: 'person', id: person.id, name: person.name, role: 'cast' }));
            if (directing) actions.append(crew, cast);
            else actions.append(cast, crew);
            return node;
        });

        group('Studios', found.companies, (item) => simple(item, '▣', item.description));
        group('Themes', found.keywords, (item) => simple(item, '#', 'Keyword'));
    }

    // ---------- discover ----------

    function activeFilterChips() {
        const f = state.filters;
        const chips = [];
        const genreName = (id) => state.reference.genres.find((genre) => String(genre.id) === id)?.name || id;
        if (f.q) chips.push([`“${f.q}”`, () => { f.q = ''; }]);
        f.genres.forEach((id) => chips.push([genreName(id), () => { f.genres = f.genres.filter((item) => item !== id); }]));
        f.excludeGenres.forEach((id) => chips.push([`not ${genreName(id)}`, () => { f.excludeGenres = f.excludeGenres.filter((item) => item !== id); }, 'neg']));
        if (f.yearFrom || f.yearTo) chips.push([`${f.yearFrom || '…'}–${f.yearTo || 'now'}`, () => { f.yearFrom = ''; f.yearTo = ''; }]);
        if (f.minImdb) chips.push([`IMDb ${f.minImdb}+`, () => { f.minImdb = ''; }]);
        if (f.minVotes) chips.push([`${Number(f.minVotes).toLocaleString()}+ votes`, () => { f.minVotes = ''; }]);
        f.platforms.forEach((id) => {
            const name = state.reference.providers.find((provider) => String(provider.id) === id)?.name || id;
            chips.push([name, () => { f.platforms = f.platforms.filter((item) => item !== id); }]);
        });
        if (!f.hideViewed) chips.push(['incl. viewed', () => { f.hideViewed = true; }]);
        return chips;
    }

    function filterCount() {
        const f = state.filters;
        return f.genres.length + f.excludeGenres.length + f.platforms.length
            + (f.yearFrom || f.yearTo ? 1 : 0) + (f.minImdb ? 1 : 0) + (f.minVotes ? 1 : 0) + (f.hideViewed ? 0 : 1);
    }

    function renderDiscover() {
        const f = state.filters;
        if (!state.library.stremio && !Object.keys(state.library.films || {}).length) {
            const nudge = el(`
              <div class="nudge">
                <span><b>Your library is empty.</b> Bring in everything from your Stremio account.</span>
              </div>
            `);
            nudge.appendChild(button(
                addonInstalled() || hasDeviceLogin() ? 'Update Shelves' : 'Import from Stremio',
                'btn primary sm',
                addonInstalled() || hasDeviceLogin() ? updateShelves : connectStremio
            ));
            view.appendChild(nudge);
        }
        view.appendChild(commandBar());

        if (f.scope) {
            const info = state.scopeInfo && state.scopeInfo.id === f.scope.id ? state.scopeInfo : null;
            const banner = el(`
              <div class="scope">
                <div class="scope-text">
                  <span class="eyebrow">${escapeHtml(scopeKindLabel(f.scope))}</span>
                  <span class="scope-name">${escapeHtml(scopeTitle(f.scope))}</span>
                  ${info && info.total ? `<span class="scope-count">${info.total} ${f.scope.kind === 'person' ? 'credits' : 'films'}</span>` : ''}
                </div>
                <div class="scope-actions"></div>
              </div>
            `);
            const actions = banner.querySelector('.scope-actions');
            if (f.scope.kind === 'person') {
                const crewLabel = state.type === 'series' ? 'Creator' : 'Director';
                const roles = [['crew', crewLabel], ['cast', 'Actor']];
                const current = f.scope.role === 'crew' ? 'crew' : 'cast';
                actions.appendChild(segmented(roles, current, (role) => {
                    if (role === current) return;
                    applyScope({ ...f.scope, role }, { sort: f.sort });
                }, 'sm'));
            }
            actions.appendChild(button('✕ Clear', 'btn ghost sm', clearScope));
            view.appendChild(banner);
        }

        const controls = el('<div class="controls"></div>');
        const sorts = scopeHasOrder(f.scope) ? [['list', f.scope.kind === 'collection' ? 'Saga order' : f.scope.id === 'criterion' ? 'Spine order' : 'List order'], ...SORTS] : SORTS;
        controls.appendChild(segmented(sorts, f.sort, (id) => { f.sort = id; scheduleSearch(); }, 'sorts'));
        const count = filterCount();
        controls.appendChild(button(`Filters${count ? ` <span class="count">${count}</span>` : ''}`, `btn ${state.filtersOpen ? 'on' : ''}`, () => {
            if (state.filtersOpen) closeFilters();
            else openFilters();
        }));
        controls.appendChild(button('Save as Board row', 'btn ghost', () => saveView()));
        view.appendChild(controls);

        const chips = activeFilterChips();
        if (chips.length && !state.filtersOpen) {
            const row = el('<div class="chips active"></div>');
            chips.forEach(([label, remove, tone]) => {
                row.appendChild(button(`${escapeHtml(label)} <span aria-hidden="true">✕</span>`, `chip removable ${tone || ''}`, () => { remove(); scheduleSearch(); }));
            });
            row.appendChild(button('Reset', 'chip ghost', () => {
                state.filters = blankFilters({ country: f.country, scope: f.scope, sort: f.sort });
                state.commandQuery = '';
                scheduleSearch();
            }));
            view.appendChild(row);
        }

        if (state.filtersOpen) view.appendChild(filterDrawer());

        if (state.error) view.appendChild(el(`<div class="notice error-box">${escapeHtml(state.error)}</div>`));
        if (state.notice) view.appendChild(el(`<div class="notice">${escapeHtml(state.notice)}</div>`));

        const status = el('<div class="status"></div>');
        if (state.loading) status.innerHTML = '<span class="pulse"></span> Loading';
        else status.textContent = `${state.results.length}${state.nextCursor ? '+' : ''} titles`;
        view.appendChild(status);

        if (state.results.length) renderGrid(state.results, view);
        else if (state.loading) view.appendChild(skeletonGrid());
        else if (!state.error) view.appendChild(el('<div class="empty">No titles match. Try fewer filters.</div>'));

        if (state.nextCursor && state.results.length) {
            const moreRow = el('<div class="more-row"></div>');
            moreRow.appendChild(button(state.loading ? 'Loading…' : 'Load more', 'btn', () => search(state.nextCursor)));
            view.appendChild(moreRow);
        }
    }

    function skeletonGrid() {
        const grid = el('<div class="grid"></div>');
        for (let i = 0; i < 12; i += 1) grid.appendChild(el('<div class="card skeleton"><div class="poster"></div><div class="sk-line"></div></div>'));
        return grid;
    }

    function drawerSection(label, content) {
        const section = el(`<div class="fsec"><div class="fsec-label">${escapeHtml(label)}</div><div class="fsec-body"></div></div>`);
        section.querySelector('.fsec-body').appendChild(content);
        return section;
    }

    const DRAWER_KEYS = ['genres', 'excludeGenres', 'yearFrom', 'yearTo', 'minImdb', 'minVotes', 'platforms', 'country', 'hideViewed'];

    function drawerFields(filters) {
        return JSON.parse(JSON.stringify(Object.fromEntries(DRAWER_KEYS.map((key) => [key, filters[key]]))));
    }

    function draftChanged() {
        return JSON.stringify(state.draft) !== JSON.stringify(drawerFields(state.filters));
    }

    function openFilters() {
        state.draft = drawerFields(state.filters);
        state.filtersOpen = true;
        render();
    }

    async function closeFilters() {
        const changed = state.draft && draftChanged();
        if (changed) Object.assign(state.filters, state.draft);
        state.draft = null;
        state.filtersOpen = false;
        if (!changed) return render();
        await search();
    }

    function filterDrawer() {
        const f = state.draft || (state.draft = drawerFields(state.filters));
        const drawer = el('<div class="drawer"></div>');

        if (state.reference.genres?.length) {
            const genres = el('<div class="chips"></div>');
            state.reference.genres.forEach((genre) => {
                const id = String(genre.id);
                const mode = f.genres.includes(id) ? 'on' : f.excludeGenres.includes(id) ? 'neg' : '';
                genres.appendChild(button(`${mode === 'neg' ? '− ' : mode === 'on' ? '+ ' : ''}${escapeHtml(genre.name)}`, `chip ${mode}`, () => {
                    f.genres = f.genres.filter((item) => item !== id);
                    f.excludeGenres = f.excludeGenres.filter((item) => item !== id);
                    if (!mode) f.genres.push(id);
                    else if (mode === 'on') f.excludeGenres.push(id);
                    render();
                }));
            });
            const section = drawerSection('Genres', genres);
            section.querySelector('.fsec-label').appendChild(el('<small>click: include → exclude → off</small>'));
            drawer.appendChild(section);
        }

        const years = el('<div class="years"></div>');
        const from = el(`<input class="input num" type="number" min="1900" max="${THIS_YEAR}" placeholder="From" value="${escapeHtml(f.yearFrom)}">`);
        const to = el(`<input class="input num" type="number" min="1900" max="${THIS_YEAR + 2}" placeholder="To" value="${escapeHtml(f.yearTo)}">`);
        from.onchange = () => { f.yearFrom = from.value.slice(0, 4); render(); };
        to.onchange = () => { f.yearTo = to.value.slice(0, 4); render(); };
        years.append(from, el('<span class="dash">–</span>'), to);
        const decades = el('<div class="chips"></div>');
        DECADES.forEach(([label, yearFrom, yearTo]) => {
            const on = f.yearFrom === yearFrom && f.yearTo === yearTo;
            decades.appendChild(button(label, `chip ${on ? 'on' : ''}`, () => {
                f.yearFrom = on ? '' : yearFrom;
                f.yearTo = on ? '' : yearTo;
                render();
            }));
        });
        years.appendChild(decades);
        drawer.appendChild(drawerSection('Years', years));

        const scores = el('<div class="split"></div>');
        scores.appendChild(segmented(IMDB_STEPS, f.minImdb, (id) => { f.minImdb = id; render(); }, 'sm'));
        drawer.appendChild(drawerSection('IMDb', scores));
        drawer.appendChild(drawerSection('Votes', segmented(VOTE_STEPS, f.minVotes, (id) => { f.minVotes = id; render(); }, 'sm')));

        const where = el('<div class="where"></div>');
        const country = el('<select class="input select"></select>');
        (state.reference.countries || []).forEach((item) => {
            country.appendChild(el(`<option value="${escapeHtml(item.code)}" ${item.code === f.country ? 'selected' : ''}>${escapeHtml(item.name)}</option>`));
        });
        country.onchange = async () => {
            f.country = country.value;
            f.platforms = [];
            await loadReference(f.country).catch(() => {});
            render();
        };
        where.appendChild(country);
        const providers = state.reference.providers || [];
        if (providers.length) {
            const list = el('<div class="chips"></div>');
            const visible = state.allPlatforms ? providers : providers.slice(0, 14);
            visible.forEach((provider) => {
                const id = String(provider.id);
                const on = f.platforms.includes(id);
                list.appendChild(button(escapeHtml(provider.name), `chip ${on ? 'on' : ''}`, () => {
                    f.platforms = on ? f.platforms.filter((item) => item !== id) : [...f.platforms, id];
                    render();
                }));
            });
            if (providers.length > 14) {
                list.appendChild(button(state.allPlatforms ? 'Show less' : `+${providers.length - 14} more`, 'chip ghost', () => {
                    state.allPlatforms = !state.allPlatforms;
                    render();
                }));
            }
            where.appendChild(list);
        }
        drawer.appendChild(drawerSection('Streaming', where));

        const toggle = el(`
          <label class="switch">
            <input type="checkbox" ${f.hideViewed ? 'checked' : ''}>
            <span class="track"></span>
            <span>Hide titles I've viewed</span>
          </label>
        `);
        toggle.querySelector('input').onchange = (event) => { f.hideViewed = event.target.checked; render(); };
        drawer.appendChild(drawerSection('Viewed', toggle));

        const foot = el('<div class="drawer-foot"></div>');
        foot.appendChild(button('Reset filters', 'btn ghost sm', () => {
            state.draft = drawerFields(blankFilters({ country: f.country }));
            render();
        }));
        if (draftChanged()) foot.appendChild(el('<span class="muted small">Applies when you press Done</span>'));
        foot.appendChild(button('Done', 'btn primary sm', closeFilters));
        drawer.appendChild(foot);
        return drawer;
    }

    // ---------- stremio sync ----------

    const STALE_MS = 15 * 60 * 1000;
    let syncing = false;

    function timeAgo(time) {
        if (!time) return 'never';
        const minutes = Math.round((Date.now() - time) / 60000);
        if (minutes < 1) return 'just now';
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.round(minutes / 60);
        if (hours < 48) return `${hours}h ago`;
        return `${Math.round(hours / 24)}d ago`;
    }

    function syncSummary(result) {
        if (!result) return 'Synced';
        const parts = [];
        if (result.added) parts.push(`${result.added} added`);
        if (result.viewed) parts.push(`${result.viewed} marked viewed`);
        if (result.removed) parts.push(`${result.removed} removed`);
        return parts.length ? `Stremio sync: ${parts.join(' · ')}` : 'Stremio sync: already up to date';
    }

    async function syncStremio({ quiet = false } = {}) {
        if (syncing) return;
        syncing = true;
        render();
        try {
            const payload = await api('/stremio/sync', { method: 'POST' });
            state.library = payload.library;
            if (!quiet || payload.result.added || payload.result.viewed) toast(syncSummary(payload.result));
        } catch (error) {
            await reload().catch(() => {});
            if (!quiet) toast(error.message);
        } finally {
            syncing = false;
            render();
        }
    }

    function autoSync() {
        const link = state.library && state.library.stremio;
        if (!link || link.error) return;
        if (!link.lastSync || Date.now() - link.lastSync > STALE_MS) syncStremio({ quiet: true });
    }

    function connectStremio() {
        const already = addonInstalled();
        const backdrop = el(`
          <div class="modal-backdrop">
            <div class="modal small">
              <button type="button" class="btn ghost icon modal-close" aria-label="Close">✕</button>
              <span class="eyebrow">Stremio account</span>
              <h2 id="stremio-title">${already ? 'Update your Shelves' : 'Bring your Stremio library'}</h2>
              <p class="muted small" id="stremio-lede">${already
            ? 'Shelves are already on your Board. Sync updates your Streamlol library from Stremio — it will not install another addon.'
            : 'Imports your Library and watched history, then keeps syncing. Streamlol only reads — it never changes your Stremio account.'}</p>
              <div class="device-login" id="device-login" hidden>
                <button type="button" class="btn primary wide" id="use-device"><span id="use-device-label">Continue as </span><span id="use-device-email"></span></button>
                <p class="error" id="device-error"></p>
                <button type="button" class="btn ghost sm" id="other-account">Use another account</button>
              </div>
              <div id="login-panes">
              <div class="seg tabs-auth" style="margin:0.75rem 0 1rem">
                <button type="button" class="seg-item on" data-mode="password">Email & password</button>
                <button type="button" class="seg-item" data-mode="key">Google / Facebook / Apple</button>
              </div>
              <form id="stremio-form">
                <div data-pane="password" class="stack">
                  <input class="input wide" name="email" type="email" autocomplete="username" placeholder="Stremio email">
                  <input class="input wide" name="password" type="password" autocomplete="current-password" placeholder="Password">
                  <p class="muted small">Your password goes straight to Stremio to get a session key and is never stored.</p>
                </div>
                <div data-pane="key" class="stack" hidden>
                  <ol class="howto">
                    <li>Open <a href="https://web.stremio.com" target="_blank" rel="noopener">web.stremio.com</a> and sign in</li>
                    <li>Press <b>F12</b> → <b>Console</b>, paste this and press Enter:</li>
                  </ol>
                  <div class="snippet"><code class="mono">copy(JSON.parse(localStorage.profile).auth.key)</code><button type="button" class="btn ghost sm" id="copy-snippet">Copy</button></div>
                  <p class="muted small">That copies your session key. Paste it here:</p>
                  <input class="input wide mono" name="authKey" autocomplete="off" spellcheck="false" placeholder="Stremio auth key">
                </div>
                <p class="error" id="stremio-error"></p>
                <div class="row end">
                  <button type="button" class="btn ghost" id="cancel">Cancel</button>
                  <button type="submit" class="btn primary" id="go">${already ? 'Update & sync' : 'Connect & import'}</button>
                </div>
              </form>
              </div>
            </div>
          </div>
        `);
        modalRoot.appendChild(backdrop);
        let mode = 'password';
        const form = backdrop.querySelector('#stremio-form');
        const close = () => backdrop.remove();
        backdrop.querySelector('.modal-close').onclick = close;
        backdrop.querySelector('#cancel').onclick = close;
        backdrop.querySelectorAll('[data-mode]').forEach((tab) => {
            tab.onclick = () => {
                mode = tab.dataset.mode;
                backdrop.querySelectorAll('[data-mode]').forEach((item) => item.classList.toggle('on', item === tab));
                backdrop.querySelectorAll('[data-pane]').forEach((pane) => { pane.hidden = pane.dataset.pane !== mode; });
                form.querySelector(mode === 'key' ? '[name=authKey]' : '[name=email]').focus();
            };
        });
        backdrop.querySelector('#copy-snippet').onclick = async (event) => {
            try {
                await navigator.clipboard.writeText('copy(JSON.parse(localStorage.profile).auth.key)');
                event.target.textContent = 'Copied ✓';
            } catch { /* manual copy */ }
        };
        form.querySelector('[name=email]').focus();

        function applyAddonCopy(installed) {
            backdrop.querySelector('#stremio-title').textContent = installed ? 'Update your Shelves' : 'Bring your Stremio library';
            backdrop.querySelector('#stremio-lede').textContent = installed
                ? 'Shelves are already on your Board. Sync updates your Streamlol library from Stremio — it will not install another addon.'
                : 'Imports your Library and watched history, then keeps syncing. Streamlol only reads — it never changes your Stremio account.';
            const go = backdrop.querySelector('#go');
            if (go && !go.disabled) go.textContent = installed ? 'Update & sync' : 'Connect & import';
            const useLabel = backdrop.querySelector('#use-device-label');
            if (useLabel) useLabel.textContent = installed ? 'Update as ' : 'Continue as ';
        }

        async function connectWith(body, go, err) {
            const label = go.innerHTML;
            const busy = addonInstalled() || (state.deviceSession && state.deviceSession.addon && state.deviceSession.addon.installed);
            err.textContent = '';
            go.disabled = true;
            go.textContent = busy ? 'Updating…' : 'Importing…';
            try {
                const payload = await api('/stremio', { method: 'POST', body });
                state.library = payload.library;
                const addon = payload.addon || (state.library.stremio && state.library.stremio.addon);
                state.deviceSession = {
                    saved: true,
                    email: state.library.stremio && state.library.stremio.email,
                    addon: addon ? { installed: Boolean(addon.installed), transportUrl: addon.transportUrl || null } : null,
                };
                close();
                const { added, viewed } = payload.result;
                const parts = [];
                if (addon && addon.wasInstalled) parts.push('Shelves updated');
                else if (addon && addon.installed) parts.push('Shelves added to Board');
                parts.push(`synced ${added} titles${viewed ? ` · ${viewed} viewed` : ''}`);
                toast(parts.join(' · '));
                state.active = { kind: 'library' };
                setInstallLink();
                render();
                return true;
            } catch (error) {
                err.textContent = error.message;
                go.disabled = false;
                go.innerHTML = label;
                return false;
            }
        }

        form.onsubmit = (event) => {
            event.preventDefault();
            const body = mode === 'key'
                ? { authKey: form.authKey.value.trim() }
                : { email: form.email.value.trim(), password: form.password.value };
            connectWith(body, backdrop.querySelector('#go'), backdrop.querySelector('#stremio-error'));
        };

        const device = backdrop.querySelector('#device-login');
        const panes = backdrop.querySelector('#login-panes');
        const showLogin = () => {
            device.hidden = true;
            panes.hidden = false;
            form.querySelector('[name=email]').focus();
        };
        backdrop.querySelector('#other-account').onclick = showLogin;

        const showDevice = (saved) => {
            if (!saved || !saved.saved || !backdrop.isConnected) return;
            state.deviceSession = saved;
            const installed = Boolean(saved.addon && saved.addon.installed);
            applyAddonCopy(installed);
            backdrop.querySelector('#use-device-email').textContent = saved.email || 'your Stremio account';
            device.hidden = false;
            panes.hidden = true;
            const use = backdrop.querySelector('#use-device');
            use.focus();
            use.onclick = async () => {
                const ok = await connectWith({ device: true }, use, backdrop.querySelector('#device-error'));
                if (!ok && backdrop.isConnected) setTimeout(showLogin, 1200);
            };
            setInstallLink();
        };

        if (state.deviceSession && state.deviceSession.saved) showDevice(state.deviceSession);
        else api('/stremio/device').then(showDevice).catch(() => {});
    }

    function stremioBar() {
        const link = state.library.stremio;
        if (!link) return null;
        const bar = el(`
          <div class="sync-bar ${link.error ? 'warn' : ''}">
            <span class="sync-dot ${syncing ? 'busy' : ''}"></span>
            <span>${link.error
                ? 'Stremio session expired'
                : `Synced with Stremio${link.email ? ` · ${escapeHtml(link.email)}` : ''} · ${syncing ? 'syncing…' : timeAgo(link.lastSync)}`}</span>
          </div>
        `);
        bar.appendChild(link.error
            ? button('Reconnect', 'btn ghost sm', connectStremio)
            : button(syncing ? 'Syncing…' : '↻ Sync', 'btn ghost sm', () => syncStremio()));
        return bar;
    }

    function emptyShelf() {
        const connected = Boolean(state.library.stremio);
        if (connected || state.active.kind === 'reviewed' || state.active.kind === 'list') {
            const text = {
                library: 'Nothing in your Library yet. Add titles from Discover or your Stremio library.',
                viewed: 'No viewed titles yet. Mark something viewed, or watch it in Stremio and sync.',
                reviewed: 'No reviews yet. Open any title and give it a score.',
                list: 'This list is empty. Open a title and use “Lists” to add it here.',
            }[state.active.kind] || 'Nothing here yet.';
            return el(`<div class="empty">${escapeHtml(text)}</div>`);
        }
        const installed = addonInstalled();
        const remembered = hasDeviceLogin();
        const card = el(`
          <div class="import-card">
            <div class="import-copy">
              <span class="eyebrow">${installed ? 'Shelves already on your Board' : 'Start with what you already have'}</span>
              <h2>${installed ? 'Update your Shelves' : 'Import your Stremio library'}</h2>
              <p class="muted">${installed
            ? 'Sync your Stremio Library and watched history into Streamlol. This updates the existing Shelves addon — it will not install another copy.'
            : 'Everything in your Stremio Library and your watched history lands here in seconds — and keeps syncing as you watch.'}</p>
              <div class="row"></div>
            </div>
            <div class="import-art" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span></div>
          </div>
        `);
        const row = card.querySelector('.row');
        row.appendChild(button(
            installed || remembered ? 'Update Shelves →' : 'Connect Stremio →',
            'btn primary',
            installed || remembered ? updateShelves : connectStremio
        ));
        row.appendChild(button('Browse Discover', 'btn ghost', () => { state.active = { kind: 'discover' }; render(); if (!state.results.length) search(); }));
        return card;
    }

    // ---------- shelves ----------

    function renderShelf() {
        const bar = stremioBar();
        if (bar) view.appendChild(bar);
        const toolbar = el('<div class="controls"></div>');
        const input = el(`<input class="input grow" placeholder="Filter this shelf" value="${escapeHtml(state.shelf.q)}">`);
        input.oninput = () => { state.shelf.q = input.value; renderShelfBody(); };
        toolbar.appendChild(input);
        const sorts = [['added', 'Added'], ['recent', 'Recent'], ['title', 'A–Z'], ['year', 'Year'], ['imdb', 'IMDb'], ['score', 'My score']];
        toolbar.appendChild(segmented(sorts, state.shelf.sort, (id) => { state.shelf.sort = id; render(); }, 'sm'));
        if (state.active.kind === 'list') {
            toolbar.append(button('Rename', 'btn ghost sm', () => renameList()), button('Delete', 'btn ghost sm danger', () => deleteList()));
        }
        view.appendChild(toolbar);
        renderShelfBody();
    }

    function renderShelfBody() {
        const old = view.querySelector('[data-shelf-body]');
        if (old) old.remove();
        const body = el('<div data-shelf-body></div>');
        let films = sortShelf(shelfFilms());
        const q = state.shelf.q.toLowerCase();
        if (q) films = films.filter((film) => (film.title || '').toLowerCase().includes(q));
        if (!films.length) {
            body.appendChild(q ? el('<div class="empty">No titles on this shelf match that.</div>') : emptyShelf());
        } else if (state.active.kind === 'viewed' && state.shelf.sort === 'recent') {
            calendarGroups(films).forEach((group) => {
                body.appendChild(el(`<div class="month">${escapeHtml(group.label)}<span>${group.films.length}</span></div>`));
                renderGrid(group.films, body);
            });
        } else {
            renderGrid(films, body);
        }
        view.appendChild(body);
    }

    // ---------- film modal ----------

    async function openFilm(film) {
        state.stack = [film];
        await showFilmModal();
    }

    async function showFilmModal() {
        const film = state.stack[state.stack.length - 1];
        const type = typeOf(film);
        modalRoot.innerHTML = '';
        const backdrop = el('<div class="modal-backdrop"></div>');
        const modal = el(`
          <div class="modal film" role="dialog">
            <div class="film-bg"></div>
            <button type="button" class="btn ghost icon modal-close" aria-label="Close">✕</button>
            <div class="hero">
              <div class="hero-poster">${film.poster ? `<img src="${escapeHtml(film.poster)}" alt="">` : ''}</div>
              <div class="hero-main">
                <h2>${escapeHtml(film.title || film.imdbId)}</h2>
                <div class="hero-facts">Loading…</div>
                <div class="row" id="film-actions"></div>
              </div>
            </div>
            <div id="film-body"></div>
          </div>
        `);
        backdrop.appendChild(modal);
        modalRoot.appendChild(backdrop);
        const close = () => { modalRoot.innerHTML = ''; };
        modal.querySelector('.modal-close').onclick = close;
        backdrop.onclick = (event) => { if (event.target === backdrop) close(); };

        let info = null;
        let rows = [];
        try {
            [info, rows] = await Promise.all([
                api(`/details/${type}/${film.imdbId}`),
                api(`/suggestions/${type}/${film.imdbId}`).then((payload) => payload.rows || []).catch(() => []),
            ]);
        } catch {
            info = film;
        }
        if (!modalRoot.contains(modal)) return;

        const data = { ...film, ...info, type };
        if (data.background) {
            modal.querySelector('.film-bg').style.backgroundImage = `url("${data.background.replace(/"/g, '')}")`;
        }
        const facts = [
            data.releaseInfo || data.year,
            data.runtime,
            data.seasons ? `${data.seasons} seasons` : null,
            type === 'series' ? 'Series' : null,
        ].filter(Boolean);
        const factsNode = modal.querySelector('.hero-facts');
        factsNode.innerHTML = `${data.imdbRating ? `<span class="imdb">IMDb ${escapeHtml(data.imdbRating)}</span>` : ''}${facts.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}`;
        if ((data.genres || []).length) {
            modal.querySelector('.hero-main').appendChild(el(`<div class="hero-genres">${data.genres.slice(0, 4).map((genre) => `<span>${escapeHtml(genre)}</span>`).join('')}</div>`));
        }
        if (data.description) modal.querySelector('.hero-main').appendChild(el(`<p class="hero-desc">${escapeHtml(data.description)}</p>`));

        const actions = modal.querySelector('#film-actions');
        const payload = {
            imdbId: data.imdbId,
            type,
            title: data.title,
            year: data.year,
            poster: data.poster,
            background: data.background || null,
            genres: data.genres || [],
            imdbRating: data.imdbRating,
            platforms: data.platforms || [],
            description: data.description || '',
        };
        const refresh = async () => {
            await reload();
            if (modalRoot.contains(modal)) {
                renderActions();
                renderScores();
                renderLists();
            }
            render();
        };
        const label = filmLabel(data);
        function renderActions() {
            actions.innerHTML = '';
            if (state.stack.length > 1) {
                actions.appendChild(button('← Back', 'btn ghost', async () => { state.stack.pop(); await showFilmModal(); }));
            }
            const open = el('<a class="btn primary" target="_blank" rel="noopener">▶ Open in Stremio</a>');
            open.href = `stremio:///detail/${type}/${data.imdbId}`;
            actions.appendChild(open);
            const stored = state.library.films[data.imdbId];
            const status = state.library.status[data.imdbId];
            if (!stored) {
                actions.appendChild(button('+ Library', 'btn', async () => {
                    await api('/films', { method: 'POST', body: { ...payload, status: 'library' } });
                    toast(`Added “${label}” to Library`);
                    await refresh();
                }));
                actions.appendChild(button('✓ Mark viewed', 'btn', async () => {
                    await api('/films', { method: 'POST', body: { ...payload, status: 'viewed' } });
                    toast(`Marked “${label}” as viewed`);
                    await refresh();
                }));
            } else {
                actions.appendChild(button(status === 'viewed' ? '✓ Viewed' : '✓ Mark viewed', `btn ${status === 'viewed' ? 'on' : ''}`, async () => {
                    const next = status === 'viewed' ? 'library' : 'viewed';
                    await api(`/films/${data.imdbId}/status`, { method: 'POST', body: { status: next } });
                    toast(next === 'viewed' ? `Marked “${label}” as viewed` : `“${label}” back in Library`);
                    await refresh();
                }));
                actions.appendChild(button('Remove', 'btn ghost danger', async () => {
                    if (!window.confirm(`Remove “${label}” from your library?`)) return;
                    await api(`/films/${data.imdbId}`, { method: 'DELETE' });
                    toast(`Removed “${label}”`);
                    await refresh();
                }));
            }

        }
        renderActions();

        const body = modal.querySelector('#film-body');
        body.innerHTML = '';

        if (info?.cast?.length || info?.directors?.length) {
            const people = el('<div class="section"><h3>Cast & crew <small>select a person to see all their titles</small></h3><div class="people"></div></div>');
            const row = people.querySelector('.people');
            [...(info.directors || []).map((person) => ({ ...person, role: 'crew' })), ...(info.cast || []).slice(0, 10).map((person) => ({ ...person, role: 'cast' }))].forEach((person) => {
                const roleText = person.role === 'crew' ? (info.directorLabel || 'Director') : (person.character || 'Cast');
                const node = el(`
                  <button type="button" class="person ${person.role === 'crew' ? 'crew' : ''}" ${person.id ? '' : 'disabled'}>
                    ${person.photo ? `<img src="${escapeHtml(person.photo)}" alt="">` : `<span class="ph">${escapeHtml((person.name || '?').slice(0, 1))}</span>`}
                    <span class="person-name">${escapeHtml(person.name || '')}</span>
                    <span class="person-role">${escapeHtml(roleText)}</span>
                    ${person.id ? `<span class="person-go">${person.role === 'crew' ? 'All films →' : 'Filmography →'}</span>` : ''}
                  </button>
                `);
                if (person.id) {
                    node.onclick = () => applyScope({ kind: 'person', id: String(person.id), name: person.name, role: person.role }, { type });
                }
                row.appendChild(node);
            });
            body.appendChild(people);
        }

        const scoreBox = el('<div class="section"><h3>Your score</h3><div class="scores"></div></div>');
        const scores = scoreBox.querySelector('.scores');
        function renderScores() {
            scores.innerHTML = '';
            const review = state.library.reviews[data.imdbId];
            for (let score = 1; score <= 10; score += 1) {
                scores.appendChild(button(String(score), `score ${review && Math.round(review.score) === score ? 'on' : ''}`, async () => {
                    if (!state.library.films[data.imdbId]) await api('/films', { method: 'POST', body: payload });
                    await api(`/films/${data.imdbId}/review`, { method: 'POST', body: { score, note: review?.note || '' } });
                    toast(`Rated “${label}” ${score}/10`);
                    await refresh();
                }));
            }
        }
        renderScores();
        body.appendChild(scoreBox);

        const lists = el('<div class="section"><h3>Lists</h3><div class="chips"></div></div>');
        const listRow = lists.querySelector('.chips');
        function renderLists() {
            listRow.innerHTML = '';
            (state.library.lists || []).forEach((list) => {
                const inList = list.filmIds.includes(data.imdbId);
                listRow.appendChild(button(`${inList ? '✓ ' : '+ '}${escapeHtml(list.name)}`, `chip ${inList ? 'on' : ''}`, async () => {
                    if (!state.library.films[data.imdbId]) await api('/films', { method: 'POST', body: payload });
                    if (inList) {
                        await api(`/lists/${list.id}/films/${data.imdbId}`, { method: 'DELETE' });
                        toast(`Removed “${label}” from ${list.name}`);
                    } else {
                        await api(`/lists/${list.id}/films`, { method: 'POST', body: { imdbId: data.imdbId, film: payload } });
                        toast(`Added “${label}” to ${list.name}`);
                    }
                    await refresh();
                }));
            });
            listRow.appendChild(button('+ New list', 'chip add', () => createList(payload)));
        }
        renderLists();
        body.appendChild(lists);

        renderSuggestions(body, rows, type);
    }

    function renderSuggestions(body, rows, type) {
        body.querySelectorAll('.suggest-row').forEach((node) => node.remove());
        (rows || []).forEach((row) => {
            if (!row.films?.length) return;
            const box = el(`<div class="suggest-row"><div class="suggest-head"><h3>${escapeHtml(row.title)}</h3></div><div class="suggest-scroll"></div></div>`);
            if (row.person && row.person.id) {
                box.querySelector('.suggest-head').appendChild(button('See all →', 'btn ghost sm', () => applyScope({
                    kind: 'person', id: String(row.person.id), name: row.person.name, role: row.role === 'crew' ? 'crew' : 'cast',
                }, { type })));
            }
            const scroll = box.querySelector('.suggest-scroll');
            row.films.forEach((item) => {
                const btn = el(`
                  <button type="button" class="suggest" title="${escapeHtml(item.title || '')}">
                    <div class="poster">${item.poster ? `<img src="${escapeHtml(item.poster)}" alt="" loading="lazy">` : ''}</div>
                    <div class="card-title">${escapeHtml(item.title || '')}</div>
                  </button>
                `);
                btn.onclick = async () => { state.stack.push(item); await showFilmModal(); };
                scroll.appendChild(btn);
            });
            body.appendChild(box);
        });
    }

    // ---------- dialogs ----------

    function promptName(title, initial = '') {
        return new Promise((resolve) => {
            const backdrop = el(`
              <div class="modal-backdrop">
                <div class="modal small">
                  <h2>${escapeHtml(title)}</h2>
                  <input class="input wide" id="name-input" value="${escapeHtml(initial)}">
                  <div class="row end">
                    <button type="button" class="btn ghost" id="cancel">Cancel</button>
                    <button type="button" class="btn primary" id="ok">Save</button>
                  </div>
                </div>
              </div>
            `);
            modalRoot.appendChild(backdrop);
            const input = backdrop.querySelector('#name-input');
            input.focus();
            input.select();
            const done = (value) => { backdrop.remove(); resolve(value); };
            backdrop.querySelector('#ok').onclick = () => done(input.value.trim());
            backdrop.querySelector('#cancel').onclick = () => done(null);
            input.onkeydown = (event) => {
                if (event.key === 'Enter') done(input.value.trim());
                if (event.key === 'Escape') done(null);
            };
        });
    }

    async function createList(film) {
        const name = await promptName('New list');
        if (!name) return;
        const list = await api('/lists', { method: 'POST', body: { name } });
        if (film) await api(`/lists/${list.id}/films`, { method: 'POST', body: { imdbId: film.imdbId, film } });
        state.listsOpen = true;
        state.active = { kind: 'list', id: list.id };
        modalRoot.innerHTML = '';
        await afterShelfEdit(`List “${list.name}” created`);
        render();
    }

    async function renameList() {
        const list = state.library.lists.find((item) => item.id === state.active.id);
        if (!list) return;
        const name = await promptName('Rename list', list.name);
        if (!name) return;
        await api(`/lists/${list.id}`, { method: 'PATCH', body: { name } });
        await afterShelfEdit(`Renamed to “${name}”`);
        render();
    }

    async function deleteList() {
        const list = state.library.lists.find((item) => item.id === state.active.id);
        if (!list || !window.confirm(`Delete "${list.name}"? Titles stay in Library.`)) return;
        await api(`/lists/${list.id}`, { method: 'DELETE' });
        state.active = { kind: 'library' };
        await afterShelfEdit(`Deleted “${list.name}”`);
        render();
    }

    function toast(message) {
        document.querySelectorAll('.toast').forEach((node) => node.remove());
        const node = el(`<div class="toast">${escapeHtml(message)}</div>`);
        document.body.appendChild(node);
        setTimeout(() => node.classList.add('out'), 2800);
        setTimeout(() => node.remove(), 3300);
    }

    function filmLabel(film) {
        const title = (film && (film.title || film.name)) || 'Title';
        return title.length > 42 ? `${title.slice(0, 40)}…` : title;
    }

    async function saveView() {
        const suggested = state.filters.scope ? scopeTitle(state.filters.scope) : (state.filters.q ? `“${state.filters.q}”` : '');
        const name = await promptName('Save as Stremio Board row', suggested);
        if (!name) return;
        await api('/views', { method: 'POST', body: { name, filters: { ...state.filters, type: state.type } } });
        await afterShelfEdit(`Saved “${name}”`);
    }

    async function openSettings() {
        const backdrop = el(`
          <div class="modal-backdrop">
            <div class="modal small">
              <button type="button" class="btn ghost icon modal-close" aria-label="Close">✕</button>
              <h2>Settings</h2>
              <div class="kv"><span>TMDB</span><b>${hasTmdb() ? (boot.tmdb === 'server' ? 'server token' : 'connected') : 'not set'}</b></div>
              <div class="row">
                <input class="input grow" id="set-tmdb" type="password" placeholder="Paste new TMDB token">
                <button type="button" class="btn primary" id="save-tmdb">Save</button>
                ${boot.tmdb === 'user' ? '<button type="button" class="btn ghost danger" id="remove-tmdb">Remove</button>' : ''}
              </div>
              <div class="fsec-label" style="margin-top:1.25rem">Manifest</div>
              <input class="input wide mono" readonly value="${escapeHtml(boot.manifestUrl)}" onclick="this.select()">
              <div class="fsec-label" style="margin-top:1.25rem">Stremio account</div>
              <div id="stremio-settings"></div>
              <div class="fsec-label" style="margin-top:1.25rem">This device</div>
              <p class="muted small">This browser remembers your library. Bookmark the link to open it elsewhere.</p>
              <div class="row">
                <button type="button" class="btn ghost sm" id="copy-link">Copy library link</button>
                <a class="btn ghost sm" href="/configure?new=1" id="new-library">New empty library</a>
                <button type="button" class="btn ghost sm danger" id="forget">Forget on this device</button>
              </div>
              <p class="error" id="settings-error"></p>
            </div>
          </div>
        `);
        modalRoot.appendChild(backdrop);
        backdrop.querySelector('.modal-close').onclick = () => backdrop.remove();
        const stremioBox = backdrop.querySelector('#stremio-settings');
        const link = state.library.stremio;
        if (link) {
            const shelves = link.addon && link.addon.installed ? 'Shelves on Board' : 'Shelves not installed';
            stremioBox.appendChild(el(`<div class="kv"><span>${link.error ? 'Session expired' : `Connected${link.email ? ` · ${escapeHtml(link.email)}` : ''}`}</span><b class="mono small">${shelves} · synced ${timeAgo(link.lastSync)}</b></div>`));
            const row = el('<div class="row"></div>');
            row.appendChild(link.error
                ? button('Reconnect', 'btn primary sm', () => { backdrop.remove(); connectStremio(); })
                : button('↻ Sync now', 'btn ghost sm', () => { backdrop.remove(); syncStremio(); }));
            if (!link.error) {
                row.appendChild(button(addonInstalled() ? 'Update Shelves' : 'Install Shelves', 'btn ghost sm', async () => {
                    backdrop.remove();
                    await updateShelves();
                }));
            }
            row.appendChild(button('Disconnect', 'btn ghost sm danger', async () => {
                if (!window.confirm('Stop syncing with Stremio? Imported titles stay in your library.')) return;
                state.library = await api('/stremio', { method: 'DELETE' });
                setInstallLink();
                backdrop.remove();
                toast('Disconnected from Stremio');
                render();
            }));
            stremioBox.appendChild(row);
            stremioBox.appendChild(el('<p class="muted small">Syncs Library/watched into Streamlol. Board rows are <b>Shelves · …</b> — Update Shelves refreshes them without reinstalling.</p>'));
        } else {
            stremioBox.appendChild(el('<p class="muted small">Import your Stremio Library and watched history, and keep Shelves on your Board in sync.</p>'));
            stremioBox.appendChild(button('Connect Stremio', 'btn primary sm', () => { backdrop.remove(); connectStremio(); }));
        }
        const libraryLink = `${location.origin}/${boot.token}/`;
        backdrop.querySelector('#copy-link').onclick = async (event) => {
            try {
                await navigator.clipboard.writeText(libraryLink);
                event.target.textContent = 'Copied ✓';
                toast('Library link copied');
            } catch {
                window.prompt('Your library link', libraryLink);
            }
        };
        backdrop.querySelector('#new-library').onclick = (event) => {
            if (!window.confirm('Start a new empty library on this device? Keep your current link if you want to come back.')) event.preventDefault();
        };
        backdrop.querySelector('#forget').onclick = async () => {
            if (!window.confirm('Forget this library and Stremio sign-in on this device? You will need the link to open it again.')) return;
            forgetDevice();
            await api('/device', { method: 'DELETE' }).catch(() => {});
            location.href = '/';
        };
        backdrop.querySelector('#save-tmdb').onclick = async () => {
            const token = backdrop.querySelector('#set-tmdb').value.trim();
            if (!token) return;
            try {
                await api('/tmdb', { method: 'PUT', body: { token } });
                await reload();
                await loadReference();
                backdrop.remove();
                toast('TMDB connected');
                render();
            } catch (error) {
                backdrop.querySelector('#settings-error').textContent = error.message;
            }
        };
        const remove = backdrop.querySelector('#remove-tmdb');
        if (remove) {
            remove.onclick = async () => {
                await api('/tmdb', { method: 'DELETE' });
                await reload();
                backdrop.remove();
                toast('TMDB token removed');
                render();
            };
        }
    }

    function render() {
        setupAds();
        if (!hasTmdb()) {
            renderSetup();
            return;
        }
        renderTabs();
        renderMain();
    }

    settingsBtn.onclick = () => openSettings();

    document.addEventListener('keydown', (event) => {
        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
        if (event.key === '/' && !typing) {
            const input = document.getElementById('command-input');
            if (input) { event.preventDefault(); input.focus(); }
        }
        if (event.key === 'Escape' && !typing && modalRoot.lastElementChild) modalRoot.lastElementChild.remove();
    });

    async function afterShelfEdit(message) {
        await reload();
        setInstallLink();
        // Manifest version is content-hashed; if Shelves are already installed the Board
        // picks up changes without installing another addon.
        if (message) {
            toast(addonInstalled() ? `${message} · Shelves live on Board` : message);
        }
    }

    (async () => {
        try {
            await reload();
            await probeDeviceSession();
            if (hasTmdb()) {
                state.filters.country = state.library.settings.country || 'US';
                await loadReference();
                await search();
            }
            render();
            autoSync();
        } catch (error) {
            view.innerHTML = `<div class="empty error">${escapeHtml(error.message)}</div>`;
        }
    })();
})();
