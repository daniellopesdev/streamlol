const React = require('react');
const PropTypes = require('prop-types');
const { ModalDialog, TextInput, Toggle } = require('stremio/components');
const { Pill } = require('./controls');
const styles = require('./styles');

const TMDB_STEPS = [
    ['Create a free TMDB account', 'themoviedb.org/signup, then confirm the email TMDB sends you.'],
    ['Open the API settings', 'themoviedb.org/settings/api (avatar, Settings, API).'],
    ['Request an API key', 'Click Create, choose Developer and accept the terms.'],
    ['Fill the short form', 'Any app name (e.g. Streamlol), URL http://localhost, use "Personal film lists".'],
    ['Copy the token', 'Copy "API Read Access Token" (long, starts with eyJ). The 32-character API Key also works.'],
    ['Paste it below', 'Press Save. It is checked with TMDB and stored on your addon server only.'],
];

const SettingsPanel = ({ library, connection, run, call, onClose }) => {
    const [token, setToken] = React.useState('');
    const [message, setMessage] = React.useState('');
    const [editing, setEditing] = React.useState(false);
    const source = library.settings.tmdb;
    const hasToken = Boolean(source);
    const configureUrl = connection.transportUrl.replace(/manifest\.json$/, 'configure');

    const save = () => {
        if (!token.trim()) {
            setMessage('Paste the token first.');
            return;
        }
        setMessage('Checking with TMDB...');
        run(async () => {
            await call('/tmdb', { method: 'PUT', body: { token: token.trim() } });
            setToken('');
            setEditing(false);
            setMessage('Token saved. Platforms and suggestions are ready.');
        }).then((ok) => {
            if (!ok) setMessage('');
        });
    };

    return (
        <ModalDialog className={styles['panel-modal']} title={'Shelves settings'} autoFocus={true} onCloseRequest={onClose}>
            <div className={styles['panel']}>
                <div className={styles['section']}>
                    <div className={styles['section-title']}>
                        TMDB token
                        <span className={hasToken ? styles['badge-ok'] : styles['badge']}>
                            {source === 'user' ? 'Saved' : source === 'server' ? 'Using server token' : 'Not set'}
                        </span>
                    </div>
                    {hasToken && !editing ? (
                        <>
                            <p className={styles['panel-sub']}>
                                {source === 'server'
                                    ? 'Discover uses the server TMDB token. You can override it with your own.'
                                    : 'Token is saved for this library. Platforms, cast, and director suggestions use it automatically.'}
                            </p>
                            <div className={styles['pill-row']}>
                                <Pill icon={'settings'} label={'Change token'} onClick={() => setEditing(true)} />
                                {source === 'user' ? (
                                    <Pill danger={true} label={'Remove'} onClick={() => run(async () => {
                                        await call('/tmdb', { method: 'DELETE' });
                                        setMessage('Token removed.');
                                    })} />
                                ) : null}
                            </div>
                        </>
                    ) : (
                        <>
                            <p className={styles['panel-sub']}>
                                {hasToken
                                    ? 'Paste a new token to replace the current one.'
                                    : 'Discover (platforms, cast, director suggestions) needs a free TMDB token — once.'}
                            </p>
                            {!hasToken ? (
                                <ol className={styles['steps']}>
                                    {TMDB_STEPS.map(([title, text], index) => (
                                        <li key={title}>
                                            <span className={styles['step-number']}>{index + 1}</span>
                                            <span><b>{title}.</b> {text}</span>
                                        </li>
                                    ))}
                                </ol>
                            ) : null}
                            <div className={styles['pill-row']}>
                                <TextInput
                                    className={styles['text-field']}
                                    type={'password'}
                                    value={token}
                                    placeholder={'Paste API Read Access Token'}
                                    data-autofocus={true}
                                    onChange={(event) => setToken(event.target.value)}
                                    onSubmit={save}
                                />
                                <Pill primary={true} icon={'checkmark'} label={'Save'} onClick={save} />
                                {editing ? <Pill label={'Cancel'} onClick={() => { setEditing(false); setToken(''); setMessage(''); }} /> : null}
                            </div>
                        </>
                    )}
                    {message ? <p className={styles['panel-sub']}>{message}</p> : null}
                    <div className={styles['pill-row']}>
                        <Pill icon={'link'} label={'Open TMDB API page'} href={'https://www.themoviedb.org/settings/api'} target={'_blank'} />
                        <Pill icon={'settings'} label={'Addon setup page'} href={configureUrl} target={'_blank'} />
                    </div>
                </div>

                <div className={styles['section']}>
                    <div className={styles['section-title']}>Lists</div>
                    <Toggle
                        className={styles['toggle']}
                        checked={library.settings.hideViewed !== false}
                        onClick={() => run(() => call('/settings', { method: 'PUT', body: { hideViewed: library.settings.hideViewed === false } }))}>
                        <span className={styles['toggle-label']}>Hide viewed films inside lists (also in Stremio rows)</span>
                    </Toggle>
                </div>

                <div className={styles['section']}>
                    <div className={styles['section-title']}>Addon</div>
                    <p className={styles['panel-sub']}>{connection.transportUrl}</p>
                </div>
            </div>
        </ModalDialog>
    );
};

SettingsPanel.propTypes = {
    library: PropTypes.object.isRequired,
    connection: PropTypes.object.isRequired,
    run: PropTypes.func.isRequired,
    call: PropTypes.func.isRequired,
    onClose: PropTypes.func,
};

module.exports = SettingsPanel;
