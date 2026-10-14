const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { Button, ModalDialog, TextInput } = require('stremio/components');
const { Pill, Section } = require('./controls');
const styles = require('./styles');

const SCORES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const DAY = 24 * 60 * 60 * 1000;

function typeOf(film) {
    return film.type === 'series' ? 'series' : 'movie';
}

function formatDay(time) {
    return new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const SuggestionRow = ({ row, library, onPick }) => (
    <div className={styles['suggestion-row']}>
        <div className={styles['section-title']}>{row.title}</div>
        <div className={styles['suggestion-scroll']}>
            {row.films.map((item) => {
                const status = library.status[item.imdbId];
                return (
                    <Button key={item.imdbId} className={styles['suggestion']} title={item.title} onClick={() => onPick(item)}>
                        <div className={styles['suggestion-poster']}>
                            {item.poster ? <img src={item.poster} alt={''} loading={'lazy'} /> : null}
                            {status ? <div className={styles['suggestion-status']}>{status === 'viewed' ? 'Viewed' : 'Saved'}</div> : null}
                        </div>
                        <div className={styles['suggestion-title']}>{item.title}</div>
                        {item.year ? <div className={styles['suggestion-year']}>{item.year}</div> : null}
                    </Button>
                );
            })}
        </div>
    </div>
);

SuggestionRow.propTypes = {
    row: PropTypes.object.isRequired,
    library: PropTypes.object.isRequired,
    onPick: PropTypes.func.isRequired,
};

const FilmPanel = ({ film, canGoBack, library, run, call, onOpen, onPick, onBack, onCreateList, onClose }) => {
    const imdbId = film.imdbId;
    const type = typeOf(film);
    const stored = library.films[imdbId];
    const status = library.status[imdbId];
    const review = library.reviews[imdbId];
    const lists = [...library.lists].sort((a, b) => (a.order || 0) - (b.order || 0));
    const [info, setInfo] = React.useState(null);
    const [rows, setRows] = React.useState(null);
    const [personRow, setPersonRow] = React.useState(null);
    const [personLoading, setPersonLoading] = React.useState(null);
    const [note, setNote] = React.useState(review ? review.note || '' : '');

    React.useEffect(() => {
        let cancelled = false;
        call(`/details/${type}/${imdbId}`).then((payload) => !cancelled && setInfo(payload)).catch(() => null);
        call(`/suggestions/${type}/${imdbId}`)
            .then((payload) => !cancelled && setRows(payload.rows || []))
            .catch(() => !cancelled && setRows([]));
        return () => {
            cancelled = true;
        };
    }, [imdbId, type, call]);

    const data = {
        ...film,
        ...(info ? {
            title: info.title || film.title,
            year: info.year || film.year,
            poster: info.poster || film.poster,
            genres: info.genres && info.genres.length ? info.genres : film.genres,
            imdbRating: info.imdbRating || film.imdbRating,
            description: info.description || film.description,
        } : {}),
        ...(stored || {}),
        type,
    };
    const payload = {
        imdbId,
        type,
        title: data.title,
        year: data.year,
        poster: data.poster,
        genres: data.genres || [],
        imdbRating: data.imdbRating,
        platforms: data.platforms || [],
        description: data.description || '',
    };

    const ensure = async () => {
        if (!library.films[imdbId]) await call('/films', { method: 'POST', body: payload });
    };

    const saveReview = (score) => run(async () => {
        await ensure();
        await call(`/films/${imdbId}/review`, { method: 'POST', body: { score, note } });
    });

    const loadPerson = (person, role) => {
        if (!person.id) return;
        if (personRow && personRow.person && personRow.person.id === person.id) {
            setPersonRow(null);
            return;
        }
        setPersonLoading(person.id);
        const query = new URLSearchParams({ type, role, name: person.name, exclude: imdbId });
        call(`/person/${person.id}?${query.toString()}`)
            .then(setPersonRow)
            .catch(() => setPersonRow({ id: 'none', title: `Nothing found for ${person.name}`, films: [] }))
            .finally(() => setPersonLoading(null));
    };

    const moveViewed = (days) => {
        const current = stored && stored.viewedAt ? stored.viewedAt : Date.now();
        const next = Math.min(Date.now(), current + days * DAY);
        run(() => call(`/films/${imdbId}/viewed-at`, { method: 'POST', body: { viewedAt: next } }));
    };

    const facts = [
        info && info.releaseInfo ? info.releaseInfo : data.year,
        info && info.runtime ? info.runtime : null,
        info && info.seasons ? `${info.seasons} season${info.seasons === 1 ? '' : 's'}` : null,
        data.imdbRating ? `IMDb ${data.imdbRating}` : null,
        type === 'series' ? 'Series' : null,
    ].filter(Boolean);

    const people = info ? [
        ...info.directors.map((person) => ({ ...person, role: 'crew', label: info.directorLabel })),
        ...info.cast.slice(0, 8).map((person) => ({ ...person, role: 'cast' })),
    ] : [];
    const peopleLinked = people.some((person) => person.id);
    const visibleRows = [
        ...(personRow ? [personRow] : []),
        ...((rows || []).filter((row) => !personRow || row.id !== personRow.id)),
    ];

    return (
        <ModalDialog className={styles['panel-modal']} background={(info && info.background) || data.poster || undefined} autoFocus={true} onCloseRequest={onClose}>
            <div className={styles['film-panel']}>
                <div className={styles['hero']}>
                    <div className={styles['hero-poster']}>
                        {data.poster ? <img src={data.poster} alt={''} /> : null}
                    </div>
                    <div className={styles['hero-info']}>
                        <div className={styles['hero-title']}>{data.title}</div>
                        <div className={styles['hero-facts']}>{facts.join('  ·  ')}</div>
                        {data.genres && data.genres.length ? <div className={styles['hero-genres']}>{data.genres.join(', ')}</div> : null}
                        {data.platforms && data.platforms.length ? <div className={styles['hero-genres']}>On {data.platforms.slice(0, 6).join(', ')}</div> : null}
                        {data.description ? <p className={styles['hero-description']}>{data.description}</p> : null}
                        <div className={styles['pill-row']}>
                            {canGoBack ? <Pill icon={'chevron-back'} label={'Back'} onClick={onBack} /> : null}
                            <Pill primary={true} icon={'play'} label={'Open in Stremio'} data-autofocus={true} onClick={() => onOpen(type, imdbId)} />
                            {!stored ? (
                                <>
                                    <Pill icon={'add'} label={'Add to Library'} onClick={() => run(() => call('/films', { method: 'POST', body: { ...payload, status: 'library' } }))} />
                                    <Pill icon={'eye'} label={'Mark viewed'} onClick={() => run(() => call('/films', { method: 'POST', body: { ...payload, status: 'viewed' } }))} />
                                </>
                            ) : (
                                <>
                                    <Pill
                                        icon={'eye'}
                                        selected={status === 'viewed'}
                                        label={status === 'viewed' ? 'Viewed' : 'Mark viewed'}
                                        onClick={() => run(() => call(`/films/${imdbId}/status`, { method: 'POST', body: { status: status === 'viewed' ? 'library' : 'viewed' } }))}
                                    />
                                    <Pill danger={true} icon={'remove'} label={'Remove'} onClick={() => run(() => call(`/films/${imdbId}`, { method: 'DELETE' }))} />
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {people.length ? (
                    <div className={styles['section']}>
                        <div className={styles['section-title']}>
                            Cast &amp; crew
                            <span className={styles['section-hint']}>{peopleLinked ? 'Pick a person to see their other titles' : 'Add a TMDB token for cast and director suggestions'}</span>
                        </div>
                        <div className={styles['people-row']}>
                            {people.map((person) => (
                                <Button
                                    key={`${person.role}:${person.id || person.name}`}
                                    className={classnames(styles['person'], {
                                        [styles['selected']]: personRow && personRow.person && personRow.person.id === person.id,
                                        [styles['disabled']]: !person.id,
                                    })}
                                    title={person.name}
                                    onClick={() => loadPerson(person, person.role)}>
                                    <div className={styles['person-photo']}>
                                        {person.photo ? <img src={person.photo} alt={''} loading={'lazy'} /> : <span>{person.name.slice(0, 1)}</span>}
                                    </div>
                                    <div className={styles['person-name']}>{person.name}</div>
                                    <div className={styles['person-role']}>
                                        {personLoading === person.id ? 'Loading…' : person.role === 'crew' ? person.label : person.character || 'Cast'}
                                    </div>
                                </Button>
                            ))}
                        </div>
                    </div>
                ) : null}

                <Section title={'Your score'} hint={review ? `${review.score}/10` : 'Picking a score marks it viewed'}>
                    {SCORES.map((score) => (
                        <Pill key={score} className={styles['score']} label={String(score)} selected={review && Math.round(review.score) === score} onClick={() => saveReview(score)} />
                    ))}
                    {review ? <Pill label={'Clear'} onClick={() => run(() => call(`/films/${imdbId}/review`, { method: 'DELETE' }))} /> : null}
                </Section>

                <div className={styles['pill-row']}>
                    <TextInput
                        className={styles['text-field']}
                        value={note}
                        maxLength={500}
                        placeholder={'Note: what did you think?'}
                        onChange={(event) => setNote(event.target.value)}
                        onSubmit={() => review && saveReview(review.score)}
                    />
                    <Pill label={'Save note'} disabled={!review} onClick={() => saveReview(review.score)} />
                </div>

                {status === 'viewed' && stored ? (
                    <Section title={'Viewed on'} hint={'Places it in the Viewed calendar'}>
                        <Pill icon={'chevron-back'} title={'One day earlier'} onClick={() => moveViewed(-1)} />
                        <div className={styles['day-value']}>{formatDay(stored.viewedAt || Date.now())}</div>
                        <Pill icon={'chevron-forward'} title={'One day later'} onClick={() => moveViewed(1)} />
                        <Pill label={'−1 week'} onClick={() => moveViewed(-7)} />
                        <Pill label={'−1 month'} onClick={() => moveViewed(-30)} />
                        <Pill label={'Today'} onClick={() => run(() => call(`/films/${imdbId}/viewed-at`, { method: 'POST', body: { viewedAt: Date.now() } }))} />
                    </Section>
                ) : null}

                <Section title={'Lists'}>
                    {lists.map((list) => {
                        const inList = list.filmIds.includes(imdbId);
                        return (
                            <Pill
                                key={list.id}
                                icon={inList ? 'checkmark' : 'add'}
                                label={list.name}
                                selected={inList}
                                onClick={() => run(() => inList
                                    ? call(`/lists/${list.id}/films/${imdbId}`, { method: 'DELETE' })
                                    : call(`/lists/${list.id}/films`, { method: 'POST', body: { imdbId, film: payload } }))}
                            />
                        );
                    })}
                    <Pill icon={'add'} label={'New list'} onClick={() => onCreateList(payload)} />
                </Section>

                {rows === null ? <div className={styles['panel-sub']}>Finding suggestions…</div> : null}
                {visibleRows.map((row) => (
                    row.films.length
                        ? <SuggestionRow key={row.id} row={row} library={library} onPick={onPick} />
                        : <div key={row.id} className={styles['panel-sub']}>{row.title}</div>
                ))}
            </div>
        </ModalDialog>
    );
};

FilmPanel.propTypes = {
    film: PropTypes.object.isRequired,
    canGoBack: PropTypes.bool,
    library: PropTypes.object.isRequired,
    run: PropTypes.func.isRequired,
    call: PropTypes.func.isRequired,
    onOpen: PropTypes.func,
    onPick: PropTypes.func,
    onBack: PropTypes.func,
    onCreateList: PropTypes.func,
    onClose: PropTypes.func,
};

module.exports = FilmPanel;
