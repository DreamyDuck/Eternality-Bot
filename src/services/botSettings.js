const config = require('../config/config.json');

const DEFAULT_SETTINGS = Object.freeze({
    prefix: typeof config.prefix === 'string' ? config.prefix.trim() : '?',
    botName: typeof config.botName === 'string' ? config.botName.trim() : 'zar',
    color: typeof config.color === 'string' && /^[\da-f]{6}$/i.test(config.color.replace(/^#/, ''))
        ? config.color.replace(/^#/, '').toUpperCase()
        : '000000',
});
const SETTINGS_REQUEST_TIMEOUT_MS = 2000;
const WARNING_INTERVAL_MS = 60_000;
let lastWarningAt = 0;

function isSettingsResult(value) {
    return value && typeof value === 'object'
        && typeof value.prefix === 'string'
        && typeof value.botName === 'string'
        && typeof value.color === 'string'
        && /^[\da-f]{6}$/i.test(value.color);
}

function getAccentColor(settings) {
    const color = typeof settings?.color === 'string' && /^[\da-f]{6}$/i.test(settings.color)
        ? settings.color
        : DEFAULT_SETTINGS.color;
    return Number.parseInt(color, 16);
}

function withTimeout(promise, timeoutMs) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Settings request timed out')), timeoutMs);
        }),
    ]).finally(() => clearTimeout(timer));
}

async function getBotSettings(client, options = {}) {
    const enabled = options.enabled ?? process.env.DASHBOARD_ENABLED === 'true';
    if (!enabled) return DEFAULT_SETTINGS;

    const request = client?.cluster?.request;
    if (typeof request !== 'function') return DEFAULT_SETTINGS;

    try {
        const response = await withTimeout(
            request.call(client.cluster, {
                type: 'settings-read',
                options: { timeout: SETTINGS_REQUEST_TIMEOUT_MS },
            }),
            options.timeoutMs ?? SETTINGS_REQUEST_TIMEOUT_MS,
        );
        if (response?.type !== 'settings-result' || !isSettingsResult(response.values)) {
            throw new Error('Invalid settings response');
        }
        return response.values;
    } catch {
        const now = Date.now();
        if (now - lastWarningAt >= WARNING_INTERVAL_MS) {
            lastWarningAt = now;
            (options.logger ?? console).warn('[dashboard] Settings unavailable; using source defaults.');
        }
        return DEFAULT_SETTINGS;
    }
}

module.exports = {
    DEFAULT_SETTINGS,
    SETTINGS_REQUEST_TIMEOUT_MS,
    getAccentColor,
    getBotSettings,
};
