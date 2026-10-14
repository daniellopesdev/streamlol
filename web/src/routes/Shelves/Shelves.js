const React = require('react');
const PropTypes = require('prop-types');
const { useNavigate } = require('react-router');
const { MainNavBars, MetaItem, TextInput } = require('stremio/components');
const { useProfile } = require('stremio/common');
const { ADDON_ID, connectionFor, connectionFromTransport, rememberTransport, request } = require('./api');
const { Pill, ChipRow } = require('./controls');
const FilmPanel = require('./FilmPanel');
const SettingsPanel = require('./SettingsPanel');
const { DiscoverFilters, DISCOVER_SORTS, SHELF_SORTS } = require('./FiltersPanel');
const { NameDialog, ConfirmDialog } = require('./Dialogs');
const styles = require('./styles');

const TYPES = [['movie', 'Movies'], ['series', 'Series']];

const EMPTY_FILTERS = {
    q: '',
    type: 'movie',
    sort: 'popular',
    genres: [],
    excludeGenres: [],
    yearFrom: '',
    yearTo: '',
    minImdb: '',
    minVotes: '',
    platforms: [],
    country: '',
    hideViewed: true,
};

const QUICK_RATINGS = ['6', '7', '8'];

function shelfDefaults(kind) {
    return { q: '', sort: kind === 'viewed' ? 'recent' : kind === 'reviewed' ? 'score' : 'added', genre: '', platform: '', minImdb: '' };
}

function filtersFromView(view) {
    return {
        ...EMPTY_FILTERS,
        ...view.filters,
        type: view.filters.type === 'series' ? 'series' : 'movie',
        sort: view.filters.sort || 'popular',
        genres: view.filters.genres || [],
        excludeGenres: view.filters.excludeGenres || [],
        platforms: view.filters.platforms || [],
    };
}

function typeOf(film) {
    return film.type === 'series' ? 'series' : 'movie';
}

function shelfFilms(library, active, type) {
    const films = Object.values(library.films || {}).filter((film) => typeOf(film) === type);
    if (active.kind === 'library') return films.filter((film) => library.status[film.imdbId] === 'library');
    if (active.kind === 'viewed') return films.filter((film) => library.status[film.imdbId] === 'viewed');
    if (active.kind === 'reviewed') return films.filter((film) => library.reviews[film.imdbId]);
    const list = (library.lists || []).find((item) => item.id === active.id);
    if (!list) return [];
    return list.filmIds
        .map((id) => library.films[id])
        .filter((film) => film && typeOf(film) === type)
        .filter((film) => !(library.settings.hideViewed !== false && library.status[film.imdbId] === 'viewed'));
}

function sortFilms(films, sort, library) {
    const number = (value) => {
        const parsed = parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
    };
    return films.slice().sort((a, b) => {
        if (sort === 'title') return (a.title || '').localeCompare(b.title || '');
        if (sort === 'year') return (b.year || '').localeCompare(a.year || '');
        if (sort === 'imdb') return number(b.imdbRating) - number(a.imdbRating);
        if (sort === 'score') return number(library.reviews[b.imdbId]?.score) - number(library.reviews[a.imdbId]?.score);
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

function discoverQuery(filters, cursor) {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    params.set('q', filters.q || '');
    params.set('type', filters.type || 'movie');
    params.set('sort', filters.sort || 'popular');
    params.set('genres', filters.genres.join(','));
    params.set('excludeGenres', filters.excludeGenres.join(','));
    params.set('yearFrom', filters.yearFrom || '');
    params.set('yearTo', filters.yearTo || '');
    params.set('minImdb', filters.minImdb || '');
    params.set('minVotes', filters.minVotes || '');
    params.set('platforms', filters.platforms.join(','));
    params.set('country', filters.country || 'US');
    params.set('hideViewed', filters.hideViewed === false ? 'false' : 'true');
    return params.toString();
}

function discoverSummary(filters, reference) {
    const providerName = new Map(reference.providers.map((item) => [String(item.id), item.name]));
    const sortLabel = (DISCOVER_SORTS.find(([id]) => id === filters.sort) || DISCOVER_SORTS[0])[1];
    return [
        sortLabel,
        ...filters.genres,
        ...filters.excludeGenres.map((name) => `not ${name}`),
        filters.minImdb ? `IMDb ${filters.minImdb}+` : null,
        filters.yearFrom || filters.yearTo ? `${filters.yearFrom || '…'}–${filters.yearTo || '…'}` : null,
        filters.minVotes ? `${filters.minVotes}+ votes` : null,
        ...filters.platforms.map((id) => providerName.get(id) || id),
        filters.platforms.length ? filters.country : null,
        filters.hideViewed === false ? 'incl. viewed' : null,
    ].filter(Boolean);
}

function shelfSummary(view) {
    const sortLabel = (SHELF_SORTS.find(([id]) => id === view.sort) || SHELF_SORTS[0])[1];
    return [sortLabel, view.genre, view.platform, view.minImdb ? `IMDb ${view.minImdb}+` : null].filter(Boolean);
}

function focusLater(element) {
    setTimeout(() => {
        if (element && element.isConnected) element.focus();
    }, 50);
}

const ConnectScreen = ({ error, onConnect }) => {
    const [draft, setDraft] = React.useState('');
    return (
        <div className={styles['empty']}>
            <div className={styles['empty-title']}>Connect your Shelves addon</div>
            <ol className={styles['steps']}>
                <li><span className={styles['step-number']}>1</span><span>Open the addon setup page (e.g. <b>http://127.0.0.1:7000/configure</b>) and press <b>Install in Stremio</b>.</span></li>
                <li><span className={styles['step-number']}>2</span><span>This tab connects automatically once the addon is installed in this profile. Or paste the manifest URL below.</span></li>
            </ol>
            <div className={styles['pill-row']}>
                <TextInput
                    className={styles['text-field']}
                    value={draft}
                    placeholder={'http://127.0.0.1:7000/<token>/manifest.json'}
                    onChange={(event) => setDraft(event.target.value)}
                    onSubmit={() => onConnect(draft.trim())}
                />
                <Pill primary={true} label={'Connect'} onClick={() => onConnect(draft.trim())} />
            </div>
            {error ? <p className={styles['error']}>{error}</p> : null}
        </div>
    );
};

const Shelves = () => {
    const navigate = useNavigate();
    const profile = useProfile();
    const installedUrl = (profile.addons || [])
        .filter((addon) => addon.manifest && addon.manifest.id === ADDON_ID)
        .map((addon) => addon.transportUrl)
        .join();
    const [manualConnection, setManualConnection] = React.useState(null);
    const connection = React.useMemo(() => manualConnection || connectionFor(profile), [manualConnection, installedUrl]);

    const [library, setLibrary] = React.useState(null);
    const [reference, setReference] = React.useState({ source: null, genres: [], providers: [], countries: [] });
    const [active, setActive] = React.useState({ kind: 'discover' });
    const [type, setType] = React.useState('movie');
    const [listsOpen, setListsOpen] = React.useState(false);
    const [filtersOpen, setFiltersOpen] = React.useState(false);
    const [shelfView, setShelfView] = React.useState(shelfDefaults('library'));
    const [filters, setFilters] = React.useState(EMPTY_FILTERS);
    const [results, setResults] = React.useState(null);
    const [nextCursor, setNextCursor] = React.useState(null);
    const [notice, setNotice] = React.useState(null);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState('');
    const [panel, setPanel] = React.useState(null);
    const returnFocus = React.useRef(null);
    const searchId = React.useRef(0);
    const sentinel = React.useRef(null);

    const call = React.useCallback((path, options) => request(connection, path, options), [connection]);

    const reload = React.useCallback(async () => {
        const next = await call('');
        setLibrary(next);
        return next;
    }, [call]);

    const loadReference = React.useCallback((country, kind) => {
        return call(`/reference?country=${encodeURIComponent(country || 'US')}&type=${kind || 'movie'}`)
            .then(setReference)
            .catch(() => null);
    }, [call]);

    const search = React.useCallback(async (nextFilters, cursor = null) => {
        const id = searchId.current + 1;
        searchId.current = id;
        setLoading(true);
        setError('');
        if (!cursor) {
            setResults(null);
            setNextCursor(null);
        }
        try {
            const payload = await call(`/discover?${discoverQuery(nextFilters, cursor)}`);
            if (searchId.current !== id) return;
            setResults((current) => cursor ? [...(current || []), ...payload.results] : payload.results);
            setNextCursor(payload.nextCursor || null);
            setNotice(payload.notice || null);
        } catch (searchError) {
            if (searchId.current !== id) return;
            setError(searchError.message);
            setNextCursor(null);
            if (!cursor) setResults([]);
        } finally {
            if (searchId.current === id) setLoading(false);
        }
    }, [call]);

    React.useEffect(() => {
        if (!connection) return;
        setError('');
        reload()
            .then((next) => {
                const initial = {
                    ...EMPTY_FILTERS,
                    country: next.settings.country || 'US',
                    hideViewed: next.settings.hideViewed !== false,
                };
                setFilters(initial);
                loadReference(initial.country, initial.type);
                search(initial);
            })
            .catch((loadError) => setError(`Could not reach the addon: ${loadError.message}`));
    }, [connection]);

    const run = React.useCallback(async (action) => {
        setError('');
        try {
            await action();
            await reload();
            return true;
        } catch (actionError) {
            setError(actionError.message);
            return false;
        }
    }, [reload]);

    const discovering = active.kind === 'discover' || active.kind === 'view';

    React.useEffect(() => {
        const node = sentinel.current;
        if (!node || !discovering || !nextCursor || loading) return undefined;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) search(filters, nextCursor);
        }, { rootMargin: '600px' });
        observer.observe(node);
        return () => observer.disconnect();
    }, [discovering, nextCursor, loading, filters, search]);

    const applyFilters = (next) => {
        if (next.type !== filters.type) loadReference(next.country, next.type);
        setFilters(next);
        search(next);
    };

    const openPanel = (next) => {
        returnFocus.current = document.activeElement;
        setPanel(next);
    };

    const closePanel = () => {
        setPanel(null);
        focusLater(returnFocus.current);
    };

    const freshFilters = (kind) => ({
        ...EMPTY_FILTERS,
        type: kind,
        country: library.settings.country || 'US',
        hideViewed: library.settings.hideViewed !== false,
    });

    const selectShelf = (next) => {
        setActive(next);
        setShelfView(shelfDefaults(next.kind));
        if (next.kind === 'view') {
            const view = library.views.find((item) => item.id === next.id);
            if (!view) return;
            const viewFilters = filtersFromView(view);
            setType(viewFilters.type);
            applyFilters(viewFilters);
        } else if (next.kind === 'discover' && (active.kind === 'view' || filters.type !== type)) {
            applyFilters(freshFilters(type));
        }
    };

    const selectType = (kind) => {
        setType(kind);
        setShelfView(shelfDefaults(active.kind));
        if (active.kind === 'view') {
            setActive({ kind: 'discover' });
            applyFilters(freshFilters(kind));
        } else if (active.kind === 'discover' && filters.type !== kind) {
            applyFilters({ ...filters, type: kind, genres: [], excludeGenres: [], platforms: [] });
        }
    };

    const connect = (url) => {
        const next = connectionFromTransport(url);
        if (!next) {
            setError('Paste the full manifest URL, including the token.');
            return;
        }
        rememberTransport(next.transportUrl);
        setManualConnection(next);
    };

    const lists = library ? [...library.lists].sort((a, b) => (a.order || 0) - (b.order || 0)) : [];
    const activeList = active.kind === 'list' ? lists.find((item) => item.id === active.id) : null;
    const activeView = active.kind === 'view' && library ? library.views.find((item) => item.id === active.id) : null;

    const baseFilms = React.useMemo(() => {
        if (!library || discovering) return [];
        return shelfFilms(library, active, type);
    }, [library, active, discovering, type]);

    const films = React.useMemo(() => {
        const q = shelfView.q.toLowerCase();
        return sortFilms(baseFilms.filter((film) => {
            if (q && !(film.title || '').toLowerCase().includes(q)) return false;
            if (shelfView.genre && !(film.genres || []).includes(shelfView.genre)) return false;
            if (shelfView.platform && !(film.platforms || []).includes(shelfView.platform)) return false;
            if (shelfView.minImdb && !(parseFloat(film.imdbRating) >= Number(shelfView.minImdb))) return false;
            return true;
        }), shelfView.sort, library);
    }, [baseFilms, shelfView, library]);

    const shelfGenres = React.useMemo(() => [...new Set(baseFilms.flatMap((film) => film.genres || []))].sort(), [baseFilms]);
    const shelfPlatforms = React.useMemo(() => [...new Set(baseFilms.flatMap((film) => film.platforms || []))].sort(), [baseFilms]);

    const moveList = (direction) => {
        const ids = lists.map((item) => item.id);
        const index = ids.indexOf(active.id);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= ids.length) return;
        [ids[index], ids[target]] = [ids[target], ids[index]];
        run(() => call('/lists/reorder', { method: 'POST', body: { ids } }));
    };

    const createList = (film) => openPanel({
        type: 'name',
        title: 'New list',
        action: 'Create',
        onSubmit: (name) => {
            setPanel(film ? { type: 'film', stack: [film] } : null);
            run(async () => {
                const list = await call('/lists', { method: 'POST', body: { name } });
                if (film) {
                    await call(`/lists/${list.id}/films`, { method: 'POST', body: { imdbId: film.imdbId, film } });
                } else {
                    setListsOpen(true);
                    setActive({ kind: 'list', id: list.id });
                }
            });
        },
    });

    const openFilm = (film) => openPanel({ type: 'film', stack: [film] });

    const badgeFor = (film) => {
        if (active.kind === 'viewed') {
            const date = new Date(film.viewedAt || film.addedAt || Date.now());
            return { className: styles['badge-date'], text: date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) };
        }
        const review = library.reviews[film.imdbId];
        if (review) return { className: styles['badge-score'], text: `★ ${review.score}` };
        if (film.imdbRating) return { className: styles['badge-imdb'], text: `IMDb ${film.imdbRating}` };
        return null;
    };

    const renderGrid = (items) => (
        <div className={styles['grid']}>
            {items.map((film) => {
                const badge = badgeFor(film);
                return (
                    <MetaItem
                        key={film.imdbId}
                        className={styles['film']}
                        type={typeOf(film)}
                        name={film.title}
                        poster={{
                            src: film.poster,
                            shape: 'poster',
                            overlay: badge ? <div className={badge.className}>{badge.text}</div> : null,
                        }}
                        watched={active.kind !== 'viewed' && library.status[film.imdbId] === 'viewed'}
                        onClick={(event) => {
                            event.preventDefault();
                            openFilm(film);
                        }}
                    />
                );
            })}
        </div>
    );

    const renderCalendar = (items) => calendarGroups(items).map((group) => (
        <div key={group.key} className={styles['calendar-group']}>
            <div className={styles['calendar-title']}>{group.label}</div>
            {renderGrid(group.films)}
        </div>
    ));

    const renderTabs = () => {
        const inLists = active.kind === 'list' || active.kind === 'view';
        return (
            <>
                <div className={styles['tabs']}>
                    <Pill icon={'search'} label={'Discover'} selected={active.kind === 'discover'} onClick={() => selectShelf({ kind: 'discover' })} />
                    <Pill label={'Library'} selected={active.kind === 'library'} onClick={() => selectShelf({ kind: 'library' })} />
                    <Pill label={'Viewed'} selected={active.kind === 'viewed'} onClick={() => selectShelf({ kind: 'viewed' })} />
                    <Pill label={'Reviewed'} selected={active.kind === 'reviewed'} onClick={() => selectShelf({ kind: 'reviewed' })} />
                    <Pill
                        icon={'caret-down'}
                        label={inLists && !listsOpen ? (activeList || activeView || {}).name || 'Lists' : 'Lists'}
                        selected={inLists}
                        className={listsOpen ? styles['open'] : null}
                        onClick={() => setListsOpen(!listsOpen)}
                    />
                    <Pill icon={'settings'} title={'Settings'} className={styles['tabs-end']} onClick={() => openPanel({ type: 'settings' })} />
                </div>
                {listsOpen ? (
                    <ChipRow label={'Lists'}>
                        {lists.map((list) => (
                            <Pill key={list.id} label={list.name} selected={active.kind === 'list' && active.id === list.id} onClick={() => selectShelf({ kind: 'list', id: list.id })} />
                        ))}
                        <Pill icon={'add'} label={'New list'} onClick={() => createList(null)} />
                        {library.views.length ? <div className={styles['tabs-divider']} /> : null}
                        {library.views.map((view) => (
                            <Pill key={view.id} icon={'filters'} label={view.name} selected={active.kind === 'view' && active.id === view.id} onClick={() => selectShelf({ kind: 'view', id: view.id })} />
                        ))}
                    </ChipRow>
                ) : null}
                <div className={styles['type-tabs']}>
                    {TYPES.map(([id, label]) => (
                        <Pill key={id} className={styles['type-tab']} label={label} selected={type === id} onClick={() => selectType(id)} />
                    ))}
                </div>
            </>
        );
    };

    const filterToggle = (summary) => (
        <Pill
            icon={'filters'}
            label={filtersOpen ? 'Hide sort & filter' : 'Sort & filter'}
            className={filtersOpen ? styles['expanded'] : null}
            onClick={() => setFiltersOpen(!filtersOpen)}
            title={summary.join(', ')}
        />
    );

    const renderShelfBar = () => {
        const summary = shelfSummary(shelfView);
        return (
            <>
                <div className={styles['toolbar']}>
                    <TextInput
                        className={styles['search-field']}
                        value={shelfView.q}
                        placeholder={'Search this shelf'}
                        onChange={(event) => setShelfView({ ...shelfView, q: event.target.value })}
                    />
                    {filterToggle(summary)}
                    {activeList ? (
                        <>
                            <Pill icon={'chevron-back'} title={'Move list left'} onClick={() => moveList(-1)} />
                            <Pill icon={'chevron-forward'} title={'Move list right'} onClick={() => moveList(1)} />
                            <Pill label={'Rename'} onClick={() => openPanel({
                                type: 'name',
                                title: 'Rename list',
                                action: 'Rename',
                                initial: activeList.name,
                                onSubmit: (name) => {
                                    closePanel();
                                    run(() => call(`/lists/${activeList.id}`, { method: 'PATCH', body: { name } }));
                                },
                            })} />
                            <Pill danger={true} label={'Delete'} onClick={() => openPanel({
                                type: 'confirm',
                                title: `Delete "${activeList.name}"?`,
                                message: 'The titles stay in your Library. Only the list is removed.',
                                action: 'Delete list',
                                onConfirm: () => {
                                    setPanel(null);
                                    setActive({ kind: 'library' });
                                    run(() => call(`/lists/${activeList.id}`, { method: 'DELETE' }));
                                },
                            })} />
                        </>
                    ) : null}
                </div>
                {filtersOpen ? (
                    <div className={styles['filter-drawer']}>
                        <ChipRow label={'Sort'}>
                            {SHELF_SORTS.filter(([id]) => !(active.kind === 'viewed' && id === 'score')).map(([id, label]) => (
                                <Pill key={id} label={label} selected={shelfView.sort === id} onClick={() => setShelfView({ ...shelfView, sort: id })} />
                            ))}
                        </ChipRow>
                        <ChipRow label={'Rating'}>
                            <Pill label={'Any'} selected={!shelfView.minImdb} onClick={() => setShelfView({ ...shelfView, minImdb: '' })} />
                            {QUICK_RATINGS.map((rating) => (
                                <Pill key={rating} label={`IMDb ${rating}+`} selected={shelfView.minImdb === rating} onClick={() => setShelfView({ ...shelfView, minImdb: rating })} />
                            ))}
                        </ChipRow>
                        {shelfGenres.length ? (
                            <ChipRow label={'Genre'}>
                                <Pill label={'All'} selected={!shelfView.genre} onClick={() => setShelfView({ ...shelfView, genre: '' })} />
                                {shelfGenres.map((genre) => (
                                    <Pill key={genre} label={genre} selected={shelfView.genre === genre} onClick={() => setShelfView({ ...shelfView, genre: shelfView.genre === genre ? '' : genre })} />
                                ))}
                            </ChipRow>
                        ) : null}
                        {shelfPlatforms.length ? (
                            <ChipRow label={'On'}>
                                <Pill label={'Anywhere'} selected={!shelfView.platform} onClick={() => setShelfView({ ...shelfView, platform: '' })} />
                                {shelfPlatforms.map((platform) => (
                                    <Pill key={platform} label={platform} selected={shelfView.platform === platform} onClick={() => setShelfView({ ...shelfView, platform: shelfView.platform === platform ? '' : platform })} />
                                ))}
                            </ChipRow>
                        ) : null}
                    </div>
                ) : <div className={styles['summary']}>{summary.join('  ·  ')}</div>}
            </>
        );
    };

    const renderDiscoverBar = () => {
        const hasTmdb = Boolean(library && library.settings.tmdb);
        const tmdb = reference.source === 'tmdb';
        const summary = discoverSummary(filters, reference);
        return (
            <>
                <div className={styles['toolbar']}>
                    <TextInput
                        className={styles['search-field']}
                        value={filters.q}
                        placeholder={type === 'series' ? 'Search series (Enter)' : 'Search movies (Enter)'}
                        onChange={(event) => setFilters({ ...filters, q: event.target.value })}
                        onSubmit={() => search(filters)}
                    />
                    <Pill primary={true} icon={'search'} label={'Search'} onClick={() => search(filters)} />
                    {filterToggle(summary)}
                    <Pill icon={'add'} label={'Save as row'} onClick={() => openPanel({
                        type: 'name',
                        title: 'Save these filters as a Stremio row',
                        action: 'Save',
                        initial: activeView ? activeView.name : '',
                        onSubmit: (name) => {
                            closePanel();
                            run(async () => {
                                const view = await call('/views', { method: 'POST', body: { name, filters } });
                                setActive({ kind: 'view', id: view.id });
                            });
                        },
                    })} />
                    {activeView ? (
                        <Pill danger={true} label={'Delete row'} onClick={() => openPanel({
                            type: 'confirm',
                            title: `Delete "${activeView.name}"?`,
                            message: 'This removes the saved filters and its Stremio row.',
                            action: 'Delete',
                            onConfirm: () => {
                                setPanel(null);
                                selectShelf({ kind: 'discover' });
                                run(() => call(`/views/${activeView.id}`, { method: 'DELETE' }));
                            },
                        })} />
                    ) : null}
                </div>
                {filtersOpen ? (
                    <div className={styles['filter-drawer']}>
                        <ChipRow label={'Sort'}>
                            {DISCOVER_SORTS.filter(([, , needs]) => !needs || tmdb).map(([id, label]) => (
                                <Pill key={id} label={label} selected={filters.sort === id} onClick={() => applyFilters({ ...filters, sort: id })} />
                            ))}
                        </ChipRow>
                        <ChipRow label={'Rating'}>
                            <Pill label={'Any'} selected={!filters.minImdb} onClick={() => applyFilters({ ...filters, minImdb: '' })} />
                            {QUICK_RATINGS.map((rating) => (
                                <Pill key={rating} label={`IMDb ${rating}+`} selected={filters.minImdb === rating} onClick={() => applyFilters({ ...filters, minImdb: rating })} />
                            ))}
                        </ChipRow>
                        <ChipRow label={'Genre'}>
                            <Pill label={'All'} selected={!filters.genres.length} onClick={() => applyFilters({ ...filters, genres: [] })} />
                            {reference.genres.map((genre) => {
                                const id = String(genre.id);
                                const on = filters.genres.includes(id);
                                return (
                                    <Pill
                                        key={id}
                                        label={genre.name}
                                        selected={on}
                                        tone={filters.excludeGenres.includes(id) ? 'exclude' : null}
                                        onClick={() => applyFilters({
                                            ...filters,
                                            genres: on ? filters.genres.filter((item) => item !== id) : [...filters.genres, id],
                                            excludeGenres: filters.excludeGenres.filter((item) => item !== id),
                                        })}
                                    />
                                );
                            })}
                        </ChipRow>
                        <ChipRow label={'More'}>
                            <Pill icon={'filters'} label={'Years, platforms, exclude genres…'} onClick={() => {
                                if (library.settings.tmdb && reference.source !== 'tmdb') {
                                    loadReference(filters.country || library.settings.country, filters.type);
                                }
                                openPanel({ type: 'discover-filters' });
                            }} />
                            {!hasTmdb ? <span className={styles['summary-hint']}>Add a TMDB token in Settings for platform filters.</span> : null}
                        </ChipRow>
                    </div>
                ) : <div className={styles['summary']}>{summary.join('  ·  ')}</div>}
                {notice ? <div className={styles['notice']}>{notice}</div> : null}
            </>
        );
    };

    const renderBody = () => {
        if (!library) return <div className={styles['empty']}><div className={styles['empty-text']}>{error || 'Loading your shelves…'}</div></div>;
        const noun = type === 'series' ? 'series' : 'movies';
        if (discovering) {
            return (
                <>
                    {renderDiscoverBar()}
                    {results && results.length ? renderGrid(results) : null}
                    {results && !results.length && !loading ? <div className={styles['empty-text']}>No {noun} match these filters. Try a lower rating or fewer genres.</div> : null}
                    {loading ? <div className={styles['empty-text']}>Searching…</div> : null}
                    {nextCursor && !loading ? (
                        <div ref={sentinel} className={styles['pill-row']}>
                            <Pill label={'Load more'} onClick={() => search(filters, nextCursor)} />
                        </div>
                    ) : null}
                </>
            );
        }
        const calendar = active.kind === 'viewed' && shelfView.sort === 'recent';
        return (
            <>
                {renderShelfBar()}
                {films.length ? (calendar ? renderCalendar(films) : renderGrid(films)) : (
                    <div className={styles['empty-text']}>
                        {baseFilms.length ? `No ${noun} match these filters.` : `No ${noun} here yet. Use Discover, then open a title to add it.`}
                    </div>
                )}
            </>
        );
    };

    const renderPanel = () => {
        if (!panel || !library) return null;
        if (panel.type === 'film') {
            const film = panel.stack[panel.stack.length - 1];
            return (
                <FilmPanel
                    key={`${film.imdbId}:${panel.stack.length}`}
                    film={film}
                    canGoBack={panel.stack.length > 1}
                    library={library}
                    run={run}
                    call={call}
                    onOpen={(kind, imdbId) => navigate(`/detail/${kind}/${imdbId}`)}
                    onPick={(next) => setPanel({ type: 'film', stack: [...panel.stack, next] })}
                    onBack={() => setPanel({ type: 'film', stack: panel.stack.slice(0, -1) })}
                    onCreateList={createList}
                    onClose={closePanel}
                />
            );
        }
        if (panel.type === 'settings') {
            return (
                <SettingsPanel
                    library={library}
                    connection={connection}
                    call={call}
                    run={(action) => run(async () => {
                        await action();
                        await loadReference(filters.country || library.settings.country, filters.type);
                        search(filters);
                    })}
                    onClose={closePanel}
                />
            );
        }
        if (panel.type === 'discover-filters') {
            return (
                <DiscoverFilters
                    filters={filters}
                    reference={reference}
                    hasTmdb={Boolean(library.settings.tmdb)}
                    onChange={setFilters}
                    onCountry={(country) => {
                        setFilters({ ...filters, country, platforms: [] });
                        loadReference(country, filters.type);
                        call('/settings', { method: 'PUT', body: { country } }).catch(() => null);
                    }}
                    onApply={() => {
                        closePanel();
                        search(filters);
                    }}
                    onReset={() => setFilters({ ...freshFilters(filters.type), country: filters.country })}
                    onSettings={() => setPanel({ type: 'settings' })}
                    onRefresh={() => loadReference(filters.country || library.settings.country, filters.type)}
                    onClose={closePanel}
                />
            );
        }
        if (panel.type === 'name') {
            return <NameDialog title={panel.title} action={panel.action} initial={panel.initial} onSubmit={panel.onSubmit} onClose={closePanel} />;
        }
        if (panel.type === 'confirm') {
            return <ConfirmDialog title={panel.title} message={panel.message} action={panel.action} onConfirm={panel.onConfirm} onClose={closePanel} />;
        }
        return null;
    };

    return (
        <MainNavBars className={styles['shelves-container']} route={'shelves'}>
            <div className={styles['shelves-content']}>
                {!connection ? <ConnectScreen error={error} onConnect={connect} /> : (
                    <>
                        {library ? renderTabs() : null}
                        {error && library ? <div className={styles['error']}>{error}</div> : null}
                        {renderBody()}
                    </>
                )}
            </div>
            {renderPanel()}
        </MainNavBars>
    );
};

ConnectScreen.propTypes = {
    error: PropTypes.string,
    onConnect: PropTypes.func,
};

module.exports = Shelves;
