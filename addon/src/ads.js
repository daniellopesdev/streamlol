function adsConfig() {
    const enabled = process.env.ADS_ENABLED === 'true' || process.env.ADS_ENABLED === '1';
    const client = String(process.env.ADSENSE_CLIENT || process.env.AD_CLIENT || '').trim();
    const slots = {
        top: String(process.env.AD_SLOT_TOP || '').trim(),
        rail: String(process.env.AD_SLOT_RAIL || '').trim(),
        footer: String(process.env.AD_SLOT_FOOTER || '').trim(),
    };
    return {
        enabled,
        network: 'adsense',
        client,
        slots,
        // Placeholders show whenever ads are enabled, even before AdSense approval.
        showPlaceholders: enabled,
        live: Boolean(enabled && client),
    };
}

module.exports = { adsConfig };
