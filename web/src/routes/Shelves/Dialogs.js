const React = require('react');
const PropTypes = require('prop-types');
const { ModalDialog, TextInput } = require('stremio/components');
const styles = require('./styles');

const NameDialog = ({ title, initial, action, onSubmit, onClose }) => {
    const [value, setValue] = React.useState(initial || '');
    const submit = () => {
        if (value.trim()) onSubmit(value.trim());
    };
    return (
        <ModalDialog
            className={styles['panel-modal']}
            title={title}
            autoFocus={true}
            onCloseRequest={onClose}
            buttons={[
                { label: action, icon: 'checkmark', props: { onClick: submit } },
                { className: styles['secondary-action'], label: 'Cancel', props: { onClick: onClose } },
            ]}>
            <div className={styles['panel']}>
                <TextInput
                    className={styles['text-field']}
                    value={value}
                    maxLength={80}
                    placeholder={'Name'}
                    data-autofocus={true}
                    onChange={(event) => setValue(event.target.value)}
                    onSubmit={submit}
                />
            </div>
        </ModalDialog>
    );
};

const ConfirmDialog = ({ title, message, action, onConfirm, onClose }) => (
    <ModalDialog
        className={styles['panel-modal']}
        title={title}
        autoFocus={true}
        onCloseRequest={onClose}
        buttons={[
            { className: styles['secondary-action'], label: 'Cancel', props: { onClick: onClose, 'data-autofocus': true } },
            { className: styles['danger-action'], label: action, icon: 'remove', props: { onClick: onConfirm } },
        ]}>
        <div className={styles['panel']}>
            <p className={styles['panel-sub']}>{message}</p>
        </div>
    </ModalDialog>
);

NameDialog.propTypes = {
    title: PropTypes.string,
    initial: PropTypes.string,
    action: PropTypes.string,
    onSubmit: PropTypes.func,
    onClose: PropTypes.func,
};

ConfirmDialog.propTypes = {
    title: PropTypes.string,
    message: PropTypes.string,
    action: PropTypes.string,
    onConfirm: PropTypes.func,
    onClose: PropTypes.func,
};

module.exports = { NameDialog, ConfirmDialog };
