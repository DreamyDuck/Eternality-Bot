const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { DashboardSessionStore } = require('../storage/sessionStore');
const { SettingsConflictError } = require('../storage/database');
const { discoverCommandCatalog } = require('../services/commandDiscovery');
const { OWNER_ID_PATTERN } = require('./config');
const { createDiscordOAuth } = require('./oauth');

const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
const OAUTH_STATE_TTL_MS = 5 * 60 * 1000;
const API_PAGE_SIZE = 20;
const SESSION_COOKIE_NAME = 'dashboard.sid';
const SETTINGS_FIELDS = ['prefix', 'botName', 'color'];

function sendError(res, status, error) {
    return res.status(status).json({ error });
}

function asyncRoute(handler) {
    return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function hasControlCharacters(value) {
    return Array.from(value).some((character) => {
        const codePoint = character.codePointAt(0);
        return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
    });
}

function timingSafeEqual(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string') return false;
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function validateSettings(values) {
    if (!values || typeof values !== 'object' || Array.isArray(values)
        || Object.keys(values).length !== SETTINGS_FIELDS.length
        || SETTINGS_FIELDS.some((field) => !Object.hasOwn(values, field))) {
        return null;
    }

    const normalized = {};
    for (const field of ['prefix', 'botName']) {
        if (typeof values[field] !== 'string') return null;
        const value = values[field].trim();
        if (!value || value.length > 32 || hasControlCharacters(value)) return null;
        normalized[field] = value;
    }
    if (typeof values.color !== 'string' || !/^[\da-f]{6}$/i.test(values.color)) return null;
    normalized.color = values.color.toUpperCase();
    return normalized;
}

function parsePage(value) {
    if (value === undefined) return 1;
    if (Array.isArray(value) || !/^\d+$/.test(String(value))) return null;
    const page = Number(value);
    return Number.isSafeInteger(page) && page > 0 ? page : null;
}

function sanitizedIdentity(identity) {
    if (!identity || typeof identity.id !== 'string' || !OWNER_ID_PATTERN.test(identity.id)
        || typeof identity.name !== 'string' || !identity.name.trim()) {
        return null;
    }
    let avatarUrl = null;
    if (typeof identity.avatarUrl === 'string') {
        try {
            const url = new URL(identity.avatarUrl);
            if (url.protocol === 'https:' && url.hostname === 'cdn.discordapp.com') {
                avatarUrl = url.href;
            }
        } catch {
            avatarUrl = null;
        }
    }
    return { id: identity.id, name: identity.name.trim().slice(0, 128), avatarUrl };
}

function createDashboardApp({
    config,
    database,
    snapshotProvider,
    commandCatalog = discoverCommandCatalog(),
    oauth = createDiscordOAuth(config),
    getOwnerId = () => config.ownerId,
    logger = console,
    staticDir = path.resolve(__dirname, '../../dashboard/dist'),
}) {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', 1);
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                baseUri: ["'self'"],
                connectSrc: ["'self'"],
                frameAncestors: ["'none'"],
                imgSrc: ["'self'", 'data:', 'https://cdn.discordapp.com'],
                objectSrc: ["'none'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                'upgrade-insecure-requests': config.cookieSecure ? [] : null,
            },
        },
        referrerPolicy: { policy: 'same-origin' },
    }));
    app.use(session({
        name: SESSION_COOKIE_NAME,
        secret: config.sessionSecret,
        store: new DashboardSessionStore(database, SESSION_MAX_AGE_MS),
        resave: false,
        saveUninitialized: false,
        rolling: true,
        cookie: {
            httpOnly: true,
            secure: config.cookieSecure,
            sameSite: 'lax',
            path: '/',
            maxAge: SESSION_MAX_AGE_MS,
        },
    }));

    const authLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 12,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (_req, res) => sendError(res, 429, 'Too many authentication requests. Try again later.'),
    });
    const apiLimiter = rateLimit({
        windowMs: 60 * 1000,
        limit: 180,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (_req, res) => sendError(res, 429, 'Too many dashboard requests. Try again later.'),
    });

    app.use('/api', (req, res, next) => {
        res.set({
            'Cache-Control': 'private, no-store, no-cache, must-revalidate',
            Pragma: 'no-cache',
            Expires: '0',
        });
        next();
    }, requireOwner, apiLimiter);
    app.use('/auth', authLimiter);

    const authRouter = express.Router();
    authRouter.get('/discord', (req, res, next) => {
        const state = crypto.randomBytes(32).toString('base64url');
        const stateHash = crypto.createHash('sha256').update(state).digest('hex');
        req.session.oauthStartedAt = Date.now();
        try {
            database.saveOAuthState(stateHash, req.sessionID, Date.now() + OAUTH_STATE_TTL_MS);
        } catch {
            return next(new Error('OAuth state storage failed'));
        }
        req.session.save((error) => {
            if (error) return next(new Error('OAuth session storage failed'));
            const authorizeUrl = new URL('https://discord.com/oauth2/authorize');
            authorizeUrl.search = new URLSearchParams({
                client_id: config.oauthClientId,
                response_type: 'code',
                redirect_uri: config.callbackUrl,
                scope: 'identify',
                state,
            }).toString();
            res.redirect(authorizeUrl.href);
        });
    });

    authRouter.get('/discord/callback', asyncRoute(async (req, res) => {
        const state = req.query.state;
        if (typeof state !== 'string' || state.length > 256) {
            return sendError(res, 400, 'The sign-in request is invalid or expired. Start again.');
        }
        const stateHash = crypto.createHash('sha256').update(state).digest('hex');
        let savedState;
        try {
            savedState = database.consumeOAuthState(stateHash, req.sessionID);
        } catch {
            return sendError(res, 503, 'Sign-in is temporarily unavailable. Try again later.');
        }
        if (!savedState || savedState.sessionId !== req.sessionID
            || Date.now() - (req.session.oauthStartedAt || 0) > OAUTH_STATE_TTL_MS) {
            return sendError(res, 400, 'The sign-in request is invalid or expired. Start again.');
        }
        if (req.query.error || typeof req.query.code !== 'string' || !req.query.code
            || req.query.code.length > 4096) {
            return sendError(res, 400, 'Discord sign-in was not completed.');
        }

        let user;
        try {
            user = sanitizedIdentity(await oauth.identify(req.query.code));
        } catch {
            logger.warn('[dashboard] Discord identity verification failed.');
            return sendError(res, 502, 'Could not verify your Discord account. Try again later.');
        }
        if (!user) return sendError(res, 502, 'Could not verify your Discord account. Try again later.');

        const currentOwnerId = getOwnerId();
        if (!OWNER_ID_PATTERN.test(currentOwnerId || '') || user.id !== currentOwnerId) {
            req.session.destroy(() => {
                res.clearCookie(SESSION_COOKIE_NAME, {
                    httpOnly: true,
                    secure: config.cookieSecure,
                    sameSite: 'lax',
                    path: '/',
                });
                sendError(res, 403, 'This dashboard is private to its configured owner.');
            });
            return;
        }

        req.session.regenerate((error) => {
            if (error) return sendError(res, 503, 'Could not create a dashboard session. Try again.');
            req.session.user = user;
            req.session.csrfToken = crypto.randomBytes(32).toString('base64url');
            req.session.absoluteExpiresAt = Date.now() + SESSION_MAX_AGE_MS;
            req.session.save((saveError) => {
                if (saveError) return sendError(res, 503, 'Could not create a dashboard session. Try again.');
                res.redirect(config.origin);
            });
        });
    }));
    app.use('/auth', authRouter);

    function rejectSession(req, res, status, message) {
        const respond = () => {
            res.clearCookie(SESSION_COOKIE_NAME, {
                httpOnly: true,
                secure: config.cookieSecure,
                sameSite: 'lax',
                path: '/',
            });
            sendError(res, status, message);
        };
        if (req.session) req.session.destroy(() => respond());
        else respond();
    }

    function requireOwner(req, res, next) {
        const ownerId = getOwnerId();
        if (!req.session?.user) return sendError(res, 401, 'Sign in with the configured dashboard owner account.');
        if (!Number.isFinite(req.session.absoluteExpiresAt) || Date.now() >= req.session.absoluteExpiresAt) {
            return rejectSession(req, res, 401, 'Your dashboard session expired. Sign in again.');
        }
        if (!OWNER_ID_PATTERN.test(ownerId || '') || req.session.user.id !== ownerId) {
            return rejectSession(req, res, 403, 'This dashboard is private to its configured owner.');
        }
        return next();
    }

    function requireSameOriginAndCsrf(req, res, next) {
        if (req.get('origin') !== config.origin
            || !timingSafeEqual(req.get('x-csrf-token'), req.session.csrfToken)) {
            return sendError(res, 403, 'The request could not be verified. Refresh the dashboard and try again.');
        }
        return next();
    }

    app.post('/auth/logout', requireOwner, requireSameOriginAndCsrf, (req, res) => {
        req.session.destroy((error) => {
            if (error) return sendError(res, 503, 'Could not end the dashboard session.');
            res.clearCookie(SESSION_COOKIE_NAME, {
                httpOnly: true,
                secure: config.cookieSecure,
                sameSite: 'lax',
                path: '/',
            });
            res.status(204).end();
        });
    });

    const api = express.Router();
    api.use((req, res, next) => {
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
        return requireSameOriginAndCsrf(req, res, next);
    });
    api.use(express.json({ limit: '16kb', strict: true }));
    api.get('/me', (req, res) => {
        const { id, name, avatarUrl } = req.session.user;
        res.json({ user: { id, name, avatarUrl }, csrfToken: req.session.csrfToken });
    });
    api.get('/overview', asyncRoute(async (_req, res) => {
        const overview = { ...await snapshotProvider.getSnapshot() };
        delete overview.guilds;
        res.json(overview);
    }));
    api.get('/guilds', asyncRoute(async (req, res) => {
        const page = parsePage(req.query.page);
        const search = req.query.search === undefined ? '' : req.query.search;
        if (!page || typeof search !== 'string' || search.length > 100) {
            return sendError(res, 400, 'Page or search parameters are invalid.');
        }
        const snapshot = await snapshotProvider.getSnapshot();
        const needle = search.trim().toLocaleLowerCase();
        const matches = needle
            ? snapshot.guilds.filter((guild) => guild.name.toLocaleLowerCase().includes(needle) || guild.id.includes(needle))
            : snapshot.guilds;
        const offset = (page - 1) * API_PAGE_SIZE;
        res.json({
            items: matches.slice(offset, offset + API_PAGE_SIZE),
            total: matches.length,
            page,
            complete: snapshot.complete,
        });
    }));
    api.get('/guilds/:id/overview', asyncRoute(async (req, res) => {
        if (!OWNER_ID_PATTERN.test(req.params.id)) return sendError(res, 404, 'Server not found.');
        const snapshot = await snapshotProvider.getSnapshot();
        const guild = snapshot.guilds.find((item) => item.id === req.params.id);
        if (!guild) {
            return snapshot.complete
                ? sendError(res, 404, 'Server not found.')
                : sendError(res, 503, 'Server status is unavailable while a Bot cluster is offline.');
        }
        const cluster = snapshot.clusters.find((item) => item.id === guild.clusterId);
        if (!cluster || !cluster.available) {
            return sendError(res, 503, 'Server status is unavailable while its Bot cluster is offline.');
        }
        res.json({ guild, sampledAt: snapshot.sampledAt, cluster });
    }));
    api.get('/settings', (_req, res) => res.json(database.readSettings()));
    api.patch('/settings', (req, res) => {
        const body = req.body;
        const values = validateSettings(body?.values);
        if (!body || typeof body !== 'object' || Array.isArray(body)
            || Object.keys(body).length !== 2 || !Object.hasOwn(body, 'version')
            || !Number.isSafeInteger(body.version) || body.version < 0 || !values) {
            return sendError(res, 400, 'Settings are invalid. Check the prefix, name, color, and version.');
        }
        try {
            return res.json(database.updateSettings({
                version: body.version,
                values,
                actorId: req.session.user.id,
            }));
        } catch (error) {
            if (error instanceof SettingsConflictError) {
                return sendError(res, 409, 'Settings changed since you loaded them. Reload and try again.');
            }
            throw error;
        }
    });
    api.delete('/settings', (req, res) => {
        const body = req.body;
        if (!body || typeof body !== 'object' || Array.isArray(body)
            || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'version')
            || !Number.isSafeInteger(body.version) || body.version < 0) {
            return sendError(res, 400, 'A settings version is required to reset the configuration.');
        }
        try {
            return res.json(database.updateSettings({
                version: body.version,
                values: database.readSettings().defaults,
                actorId: req.session.user.id,
                action: 'reset',
            }));
        } catch (error) {
            if (error instanceof SettingsConflictError) {
                return sendError(res, 409, 'Settings changed since you loaded them. Reload and try again.');
            }
            throw error;
        }
    });
    api.get('/commands', (_req, res) => res.json({ items: commandCatalog }));
    api.get('/audit', (req, res) => {
        const page = parsePage(req.query.page);
        if (!page) return sendError(res, 400, 'Page is invalid.');
        res.json(database.readAudit(page, API_PAGE_SIZE));
    });
    api.use((_req, res) => sendError(res, 404, 'Dashboard API route not found.'));
    app.use('/api', api);

    app.use('/auth', (_req, res) => sendError(res, 404, 'Authentication route not found.'));
    if (fs.existsSync(staticDir)) {
        app.use(express.static(staticDir, { index: false, fallthrough: true }));
        const indexPath = path.join(staticDir, 'index.html');
        if (fs.existsSync(indexPath)) {
            app.get('*', (req, res, next) => {
                if (req.path.includes('.') || !req.accepts('html')) return next();
                res.sendFile(indexPath);
            });
        }
    }
    app.use((req, res) => {
        if (req.path === '/api' || req.path.startsWith('/api/')) {
            return sendError(res, 404, 'Dashboard API route not found.');
        }
        if (req.path === '/auth' || req.path.startsWith('/auth/')) {
            return sendError(res, 404, 'Authentication route not found.');
        }
        return sendError(res, 404, 'Page not found.');
    });
    app.use((error, req, res, _next) => {
        if (res.headersSent) return;
        if (req.path.startsWith('/api') || req.path.startsWith('/auth')) {
            const status = error.status === 413 ? 413 : (error.status === 400 ? 400 : 500);
            return sendError(
                res,
                status,
                status === 413 ? 'Request is too large.' : (status === 400 ? 'Request body is invalid.' : 'Dashboard request failed.'),
            );
        }
        logger.error('[dashboard] Request failed.');
        return sendError(res, 500, 'Dashboard request failed.');
    });

    return app;
}

module.exports = { createDashboardApp, validateSettings, parsePage, SESSION_MAX_AGE_MS };
