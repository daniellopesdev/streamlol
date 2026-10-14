const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { Button } = require('stremio/components');
const { default: Icon } = require('@stremio/stremio-icons/react');
const styles = require('./styles');

const Pill = ({ className, label, icon, selected, primary, danger, tone, disabled, onClick, ...props }) => (
    <Button
        role={'button'}
        {...props}
        title={label || props.title}
        disabled={disabled}
        className={classnames(className, styles['pill'], {
            [styles['selected']]: selected,
            [styles['primary']]: primary,
            [styles['danger']]: danger,
            [styles['include']]: tone === 'include',
            [styles['exclude']]: tone === 'exclude',
            [styles['disabled']]: disabled,
        })}
        onClick={(event) => {
            if (!disabled && typeof onClick === 'function') onClick(event);
        }}>
        {icon ? <Icon className={styles['pill-icon']} name={icon} /> : null}
        {label ? <span className={styles['pill-label']}>{label}</span> : null}
    </Button>
);

const Section = ({ title, hint, children }) => (
    <div className={styles['section']}>
        <div className={styles['section-title']}>
            {title}
            {hint ? <span className={styles['section-hint']}>{hint}</span> : null}
        </div>
        <div className={styles['pill-row']}>{children}</div>
    </div>
);

const Stepper = ({ label, value, start, step, min, max, onChange }) => {
    const current = value === '' || value === undefined || value === null ? null : Number(value);
    const move = (direction) => {
        if (current === null) {
            onChange(String(start));
            return;
        }
        const next = current + direction * step;
        if (next < min || next > max) {
            onChange('');
            return;
        }
        onChange(String(next));
    };
    return (
        <div className={styles['stepper']}>
            <div className={styles['stepper-label']}>{label}</div>
            <Pill icon={'chevron-back'} title={`${label} down`} onClick={() => move(-1)} />
            <div className={styles['stepper-value']}>{current === null ? 'Any' : current}</div>
            <Pill icon={'chevron-forward'} title={`${label} up`} onClick={() => move(1)} />
        </div>
    );
};

const ChipRow = ({ label, children }) => (
    <div className={styles['chip-row']}>
        {label ? <div className={styles['chip-row-label']}>{label}</div> : null}
        <div className={styles['chip-row-scroll']}>{children}</div>
    </div>
);

Pill.propTypes = {
    className: PropTypes.string,
    label: PropTypes.string,
    title: PropTypes.string,
    icon: PropTypes.string,
    selected: PropTypes.bool,
    primary: PropTypes.bool,
    danger: PropTypes.bool,
    tone: PropTypes.oneOf(['include', 'exclude', null]),
    disabled: PropTypes.bool,
    onClick: PropTypes.func,
};

Section.propTypes = {
    title: PropTypes.node,
    hint: PropTypes.node,
    children: PropTypes.node,
};

Stepper.propTypes = {
    label: PropTypes.string,
    value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    start: PropTypes.number,
    step: PropTypes.number,
    min: PropTypes.number,
    max: PropTypes.number,
    onChange: PropTypes.func,
};

ChipRow.propTypes = {
    label: PropTypes.string,
    children: PropTypes.node,
};

module.exports = { Pill, Section, Stepper, ChipRow };
