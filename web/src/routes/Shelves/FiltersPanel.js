const React = require('react');
const PropTypes = require('prop-types');
const { ModalDialog, Toggle } = require('stremio/components');
const { Pill, Section, Stepper } = require('./controls');
const styles = require('./styles');

const THIS_YEAR = new Date().getFullYear();
const ERAS = [
    ['2020s', '2020', String(THIS_YEAR)],
    ['2010s', '2010', '2019'],
    ['2000s', '2000', '2009'],
    ['1990s', '1990', '1999'],
    ['1980s', '1980', '1989'],
    ['Older', '', '1979'],
];
const RATINGS = ['6', '6.5', '7', '7.5', '8', '8.5'];
const VOTES = [['100', '100+'], ['1000', '1k+'], ['10000', '10k+'], ['50000', '50k+']];
const PLATFORM_PREVIEW = 18;

const DISCOVER_SORTS = [
    ['popular', 'Popular'],
    ['rating', 'Top rated'],
    ['newest', 'Newest'],
    ['votes', 'Most voted', 'tmdb'],
];

const SHELF_SORTS = [
    ['added', 'Date added'],
    ['title', 'Title'],
    ['year', 'Year'],
    ['imdb', 'IMDb rating'],
    ['score', 'Your score'],
    ['recent', 'Recently viewed'],
];

function toggle(list, value) {
    return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function cycleGenre(filters, id) {
    if (filters.genres.includes(id)) {
        return { ...filters, genres: filters.genres.filter((item) => item !== id), excludeGenres: [...filters.excludeGenres, id] };
    }
    if (filters.excludeGenres.includes(id)) {
        return { ...filters, excludeGenres: filters.excludeGenres.filter((item) => item !== id) };
    }
    return { ...filters, genres: [...filters.genres, id] };
}

const DiscoverFilters = ({ filters, reference, hasTmdb, onChange, onCountry, onApply, onReset, onClose, onSettings, onRefresh }) => {
    const [allPlatforms, setAllPlatforms] = React.useState(false);
    const selectedPlatforms = new Set(filters.platforms);
    const providers = allPlatforms
        ? reference.providers
        : (reference.providers || []).filter((item, index) => index < PLATFORM_PREVIEW || selectedPlatforms.has(String(item.id)));
    const set = (patch) => onChange({ ...filters, ...patch });
    const tmdbReady = reference.source === 'tmdb' && (reference.providers || []).length > 0;

    return (
        <ModalDialog
            className={styles['panel-modal']}
            title={'All filters'}
            autoFocus={true}
            onCloseRequest={onClose}
            buttons={[
                { label: 'Show results', icon: 'search', props: { onClick: onApply, 'data-autofocus': true } },
                { className: styles['secondary-action'], label: 'Reset', props: { onClick: onReset } },
            ]}>
            <div className={styles['panel']}>
                <Section title={'Genres'} hint={'Press once to include, twice to exclude'}>
                    {reference.genres.map((genre) => {
                        const id = String(genre.id);
                        const tone = filters.genres.includes(id) ? 'include' : filters.excludeGenres.includes(id) ? 'exclude' : null;
                        return (
                            <Pill
                                key={id}
                                tone={tone}
                                icon={tone === 'include' ? 'checkmark' : tone === 'exclude' ? 'close' : null}
                                label={genre.name}
                                onClick={() => onChange(cycleGenre(filters, id))}
                            />
                        );
                    })}
                </Section>

                <Section title={'Minimum IMDb rating'}>
                    <Pill label={'Any'} selected={!filters.minImdb} onClick={() => set({ minImdb: '' })} />
                    {RATINGS.map((rating) => (
                        <Pill key={rating} label={`${rating}+`} selected={filters.minImdb === rating} onClick={() => set({ minImdb: rating })} />
                    ))}
                </Section>

                <Section title={'Release years'}>
                    <Pill label={'Any'} selected={!filters.yearFrom && !filters.yearTo} onClick={() => set({ yearFrom: '', yearTo: '' })} />
                    {ERAS.map(([label, from, to]) => (
                        <Pill key={label} label={label} selected={filters.yearFrom === from && filters.yearTo === to} onClick={() => set({ yearFrom: from, yearTo: to })} />
                    ))}
                </Section>
                <div className={styles['pill-row']}>
                    <Stepper label={'From'} value={filters.yearFrom} start={2000} step={1} min={1900} max={THIS_YEAR} onChange={(yearFrom) => set({ yearFrom })} />
                    <Stepper label={'To'} value={filters.yearTo} start={THIS_YEAR} step={1} min={1900} max={THIS_YEAR} onChange={(yearTo) => set({ yearTo })} />
                </div>

                {tmdbReady ? (
                    <>
                        <Section title={'Streaming on'}>
                            {providers.map((provider) => {
                                const id = String(provider.id);
                                return (
                                    <Pill key={id} label={provider.name} selected={selectedPlatforms.has(id)} icon={selectedPlatforms.has(id) ? 'checkmark' : null} onClick={() => set({ platforms: toggle(filters.platforms, id) })} />
                                );
                            })}
                            {!allPlatforms && reference.providers.length > PLATFORM_PREVIEW ? (
                                <Pill icon={'more-horizontal'} label={`All ${reference.providers.length}`} onClick={() => setAllPlatforms(true)} />
                            ) : null}
                        </Section>
                        <Section title={'Country'} hint={'Used for platform availability'}>
                            {(reference.countries || []).map((country) => (
                                <Pill key={country.code} label={country.name} selected={filters.country === country.code} onClick={() => onCountry(country.code)} />
                            ))}
                        </Section>
                        <Section title={'Minimum votes'} hint={'Filters out obscure titles'}>
                            <Pill label={'Any'} selected={!filters.minVotes} onClick={() => set({ minVotes: '' })} />
                            {VOTES.map(([value, label]) => (
                                <Pill key={value} label={label} selected={filters.minVotes === value} onClick={() => set({ minVotes: value })} />
                            ))}
                        </Section>
                    </>
                ) : hasTmdb ? (
                    <Section title={'Streaming on'} hint={'Token is already saved — load platforms'}>
                        <Pill icon={'filters'} label={'Load platforms'} onClick={onRefresh} />
                    </Section>
                ) : (
                    <Section title={'Streaming on'} hint={'Platform, country and vote filters need a free TMDB token'}>
                        <Pill icon={'settings'} label={'Add TMDB token'} onClick={onSettings} />
                    </Section>
                )}

                <div className={styles['section']}>
                    <Toggle className={styles['toggle']} checked={filters.hideViewed !== false} onClick={() => set({ hideViewed: filters.hideViewed === false })}>
                        <span className={styles['toggle-label']}>Hide films I already viewed</span>
                    </Toggle>
                </div>
            </div>
        </ModalDialog>
    );
};

DiscoverFilters.propTypes = {
    filters: PropTypes.object.isRequired,
    reference: PropTypes.object.isRequired,
    hasTmdb: PropTypes.bool,
    onChange: PropTypes.func,
    onCountry: PropTypes.func,
    onApply: PropTypes.func,
    onReset: PropTypes.func,
    onClose: PropTypes.func,
    onSettings: PropTypes.func,
    onRefresh: PropTypes.func,
};

module.exports = { DiscoverFilters, DISCOVER_SORTS, SHELF_SORTS };
