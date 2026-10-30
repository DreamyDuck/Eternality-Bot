const path = require('node:path');

const OWNER_ID_PATTERN = /^\d{17,20}$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function parseAbsoluteUrl(value, name) {
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)
            || url.username || url.password || url.search || url.hash) {
            throw new Error();
        }
        return url;
    } catch {
        throw new Error(`${name} must be an absolute HTTP(S) URL`);
    }
}

function loadDashboardConfig(env = process.env) {
    if (env.DASHBOARD_ENABLED !== 'true') return null;

    const required = [
        'DASHBOARD_OWNER_ID',
        'DASHBOARD_OAUTH_CLIENT_ID',
        'DASHBOARD_OAUTH_CLIENT_SECRET',
        'DASHBOARD_SESSION_SECRET',
        'DASHBOARD_ORIGIN',
        'DASHBOARD_CALLBACK_URL',
    ];
    const missing = required.filter((name) => !env[name]);
    if (missing.length > 0) {
        throw new Error(`Dashboard is enabled but required environment variables are missing: ${missing.join(', ')}`);
    }
    if (!OWNER_ID_PATTERN.test(env.DASHBOARD_OWNER_ID)) {
        throw new Error('DASHBOARD_OWNER_ID must be a numeric Discord snowflake');
    }
    if (env.DASHBOARD_SESSION_SECRET.length < 32) {
        throw new Error('DASHBOARD_SESSION_SECRET must be at least 32 characters');
    }

    const originUrl = parseAbsoluteUrl(env.DASHBOARD_ORIGIN, 'DASHBOARD_ORIGIN');
    const origin = originUrl.origin;
    const localHttp = originUrl.protocol === 'http:' && LOOPBACK_HOSTS.has(originUrl.hostname);
    if (originUrl.pathname !== '/' || (originUrl.protocol !== 'https:' && !(localHttp && env.NODE_ENV !== 'production'))) {
        throw new Error('DASHBOARD_ORIGIN must use HTTPS (HTTP is allowed for local development only)');
    }

    const callbackUrl = parseAbsoluteUrl(env.DASHBOARD_CALLBACK_URL, 'DASHBOARD_CALLBACK_URL');
    if (callbackUrl.origin !== origin || callbackUrl.pathname !== '/auth/discord/callback'
        || callbackUrl.href !== `${origin}/auth/discord/callback`) {
        throw new Error('DASHBOARD_CALLBACK_URL must be the dashboard origin plus /auth/discord/callback');
    }

    const port = env.DASHBOARD_PORT === undefined || env.DASHBOARD_PORT === ''
        ? 3001
        : Number(env.DASHBOARD_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('DASHBOARD_PORT must be an integer between 1 and 65535');
    }

    return {
        ownerId: env.DASHBOARD_OWNER_ID,
        oauthClientId: env.DASHBOARD_OAUTH_CLIENT_ID,
        oauthClientSecret: env.DASHBOARD_OAUTH_CLIENT_SECRET,
        sessionSecret: env.DASHBOARD_SESSION_SECRET,
        origin,
        callbackUrl: callbackUrl.href,
        port,
        databasePath: path.resolve(env.DASHBOARD_DB_PATH || 'data/dashboard.sqlite'),
        cookieSecure: originUrl.protocol === 'https:',
    };
}

module.exports = { loadDashboardConfig, OWNER_ID_PATTERN };
