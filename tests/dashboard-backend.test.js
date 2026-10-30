const assert = require('node:assert/strict');
const test = require('node:test');
const { once } = require('node:events');
const { DashboardDatabase } = require('../src/storage/database');
const { DEFAULT_SETTINGS } = require('../src/services/botSettings');
const { createDashboardApp } = require('../src/web/app');
const { loadDashboardConfig } = require('../src/web/config');

const OWNER_ID = '12345678901234567';
const OTHER_ID = '23456789012345678';
const defaults = { prefix: '?', botName: 'zar', color: '000000' };

function createTestApp({ ownerId = OWNER_ID, identity, cookieSecure = false } = {}) {
    const database = new DashboardDatabase({ filename: ':memory:', defaults });
    const config = {
        ownerId,
        oauthClientId: 'test-client',
        oauthClientSecret: 'test-secret',
        sessionSecret: 'a'.repeat(40),
        origin: 'http://dashboard.test',
        callbackUrl: 'http://dashboard.test/auth/discord/callback',
        cookieSecure,
    };
    let currentOwnerId = ownerId;
    const app = createDashboardApp({
        config,
        database,
        getOwnerId: () => currentOwnerId,
        oauth: {
            identify: async (code) => {
                if (!identity || code !== 'test-code') throw new Error('Unexpected OAuth code');
                return identity;
            },
        },
        snapshotProvider: {
            getSnapshot: async () => ({
                bot: null,
                sampledAt: '2025-01-01T00:00:00.000Z',
                complete: true,
                expectedClusters: 0,
                respondingClusters: 0,
                totals: { guilds: 0, members: 0, membersComplete: true, rssBytes: 0 },
                manager: { uptimeSeconds: 1, rssBytes: 1 },
                clusters: [],
                guilds: [],
            }),
        },
        commandCatalog: [],
        staticDir: '/dashboard-test-no-static',
    });
    return {
        app,
        database,
        config,
        setOwnerId(value) {
            currentOwnerId = value;
        },
    };
}

async function withServer(app, callback) {
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
        await callback(baseUrl);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

function responseCookie(response) {
    const cookie = response.headers.get('set-cookie');
    assert.ok(cookie, 'expected a session cookie');
    return cookie.split(';', 1)[0];
}

async function signIn(baseUrl) {
    const start = await fetch(`${baseUrl}/auth/discord`, { redirect: 'manual' });
    assert.equal(start.status, 302);
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const preAuthCookie = responseCookie(start);
    const callback = await fetch(
        `${baseUrl}/auth/discord/callback?state=${encodeURIComponent(state)}&code=test-code`,
        {
            headers: { cookie: preAuthCookie },
            redirect: 'manual',
        },
    );
    return { callback, cookie: callback.headers.get('set-cookie')?.split(';', 1)[0], preAuthCookie, state };
}

async function ownerSession(baseUrl, cookie, origin) {
    const response = await fetch(`${baseUrl}/api/me`, { headers: { cookie } });
    assert.equal(response.status, 200);
    const body = await response.json();
    return {
        user: body.user,
        csrfToken: body.csrfToken,
        origin,
    };
}

test('dashboard configuration is optional while disabled and validates owner only when enabled', () => {
    assert.equal(loadDashboardConfig({ DASHBOARD_ENABLED: 'false' }), null);
    assert.equal(loadDashboardConfig({}), null);
    assert.throws(() => loadDashboardConfig({ DASHBOARD_ENABLED: 'true' }), /required environment variables/);
    const configured = {
        DASHBOARD_ENABLED: 'true',
        DASHBOARD_OWNER_ID: OWNER_ID,
        DASHBOARD_OAUTH_CLIENT_ID: 'oauth-client',
        DASHBOARD_OAUTH_CLIENT_SECRET: 'oauth-secret',
        DASHBOARD_SESSION_SECRET: 's'.repeat(40),
        DASHBOARD_ORIGIN: 'http://localhost:5173',
        DASHBOARD_CALLBACK_URL: 'http://localhost:5173/auth/discord/callback',
    };
    assert.equal(loadDashboardConfig(configured).port, 3001);
    assert.equal(loadDashboardConfig({ ...configured, DASHBOARD_PORT: '3010' }).port, 3010);
    assert.deepEqual(DEFAULT_SETTINGS, { prefix: '?', botName: 'zar', color: '000000' });
});

test('SQLite settings updates, conflicts, resets, audit, and restart persistence', (t) => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eternality-dashboard-'));
    const filename = path.join(directory, 'dashboard.sqlite');
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

    const database = new DashboardDatabase({ filename, defaults });
    database.saveOAuthState('expired-state', 'session-id', Date.now() - 1);
    assert.equal(database.consumeOAuthState('expired-state'), null);
    database.saveOAuthState('bound-state', 'correct-session', Date.now() + 60_000);
    assert.equal(database.consumeOAuthState('bound-state', 'wrong-session'), null);
    assert.equal(database.consumeOAuthState('bound-state', 'correct-session').sessionId, 'correct-session');
    const updated = database.updateSettings({
        version: 0,
        values: { prefix: '!', botName: 'Eternality', color: 'AABBCC' },
        actorId: OWNER_ID,
    });
    assert.equal(updated.version, 1);
    assert.deepEqual(updated.values, { prefix: '!', botName: 'Eternality', color: 'AABBCC' });
    assert.throws(
        () => database.updateSettings({
            version: 0,
            values: defaults,
            actorId: OWNER_ID,
        }),
        { name: 'SettingsConflictError' },
    );
    const reset = database.updateSettings({
        version: 1,
        values: defaults,
        actorId: OWNER_ID,
        action: 'reset',
    });
    assert.equal(reset.version, 2);
    database.close();

    const reopened = new DashboardDatabase({ filename, defaults });
    assert.deepEqual(reopened.readSettings().values, defaults);
    assert.equal(reopened.readSettings().version, 2);
    assert.deepEqual(reopened.readAudit(1).items.map(({ action }) => action), ['reset', 'update']);
    reopened.close();
});

test('session cleanup prunes expired rows on throttled saveSession and touchSession writes', (t) => {
    let now = 1_000_000;
    t.mock.method(Date, 'now', () => now);
    const database = new DashboardDatabase({ filename: ':memory:', defaults });
    t.after(() => database.close());

    const insertSession = database.database.prepare(`
        INSERT INTO dashboard_sessions (sid, data, expires_at) VALUES (?, '{}', ?)
    `);
    const sessionIds = () => database.database.prepare(
        'SELECT sid FROM dashboard_sessions ORDER BY sid',
    ).all().map(({ sid }) => sid);
    const session = (expiresAt) => ({
        cookie: { expires: new Date(expiresAt).toISOString() },
    });

    insertSession.run('expired-before-boundary', now - 1);
    insertSession.run('expired-at-boundary', now);
    insertSession.run('fresh', now + 240_000);

    database.saveSession('save-trigger', session(now + 240_000), 60_000);
    assert.deepEqual(sessionIds(), [
        'expired-at-boundary',
        'expired-before-boundary',
        'fresh',
        'save-trigger',
    ]);

    now += 60_000;
    database.saveSession('save-trigger', session(now + 240_000), 60_000);
    assert.deepEqual(sessionIds(), ['fresh', 'save-trigger']);

    insertSession.run('expired-before-touch', now);
    insertSession.run('touch-trigger', now + 240_000);
    database.touchSession('touch-trigger', session(now + 240_000), 60_000);
    assert.deepEqual(sessionIds(), [
        'expired-before-touch',
        'fresh',
        'save-trigger',
        'touch-trigger',
    ]);

    now += 60_000;
    database.touchSession('touch-trigger', session(now + 240_000), 60_000);
    assert.deepEqual(sessionIds(), ['fresh', 'save-trigger', 'touch-trigger']);
});

test('session cleanup removes expired file-backed rows when reopening without requests', (t) => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eternality-dashboard-session-cleanup-'));
    const filename = path.join(directory, 'dashboard.sqlite');
    let now = 2_000_000;
    t.mock.method(Date, 'now', () => now);
    let database;
    t.after(() => {
        if (database?.database.open) database.close();
        fs.rmSync(directory, { recursive: true, force: true });
    });

    database = new DashboardDatabase({ filename, defaults });
    database.database.prepare(`
        INSERT INTO dashboard_sessions (sid, data, expires_at) VALUES (?, '{}', ?)
    `).run('expired-before-reopen', now - 1);
    database.database.prepare(`
        INSERT INTO dashboard_sessions (sid, data, expires_at) VALUES (?, '{}', ?)
    `).run('expired-at-reopen', now);
    database.database.prepare(`
        INSERT INTO dashboard_sessions (sid, data, expires_at) VALUES (?, '{}', ?)
    `).run('fresh', now + 60_000);
    database.close();

    database = new DashboardDatabase({ filename, defaults });
    const sessionIds = database.database.prepare(
        'SELECT sid FROM dashboard_sessions ORDER BY sid',
    ).all().map(({ sid }) => sid);
    assert.deepEqual(sessionIds, ['fresh']);
});

test('all API routes and logout reject unauthenticated sessions', async (t) => {
    const fixture = createTestApp();
    t.after(() => fixture.database.close());
    await withServer(fixture.app, async (baseUrl) => {
        const routes = [
            '/api/me',
            '/api/overview',
            '/api/guilds',
            `/api/guilds/${OWNER_ID}/overview`,
            '/api/settings',
            '/api/commands',
            '/api/audit',
        ];
        for (const route of routes) {
            const response = await fetch(`${baseUrl}${route}`);
            assert.equal(response.status, 401, route);
            assert.equal(typeof (await response.json()).error, 'string');
            if (route === '/api/me') {
                assert.doesNotMatch(response.headers.get('content-security-policy'), /upgrade-insecure-requests/);
            }
        }
        const malformed = await fetch(`${baseUrl}/api/settings`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: '{',
        });
        assert.equal(malformed.status, 401);
        const logout = await fetch(`${baseUrl}/auth/logout`, { method: 'POST' });
        assert.equal(logout.status, 401);
        assert.equal(typeof (await logout.json()).error, 'string');
    });
});

test('HTTPS dashboard CSP retains upgrade-insecure-requests', async (t) => {
    const fixture = createTestApp({ cookieSecure: true });
    t.after(() => fixture.database.close());
    await withServer(fixture.app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/me`);
        assert.match(response.headers.get('content-security-policy'), /upgrade-insecure-requests/);
    });
});

test('OAuth state is single-use, owner-gated, and owner rotation revokes the session', async (t) => {
    const fixture = createTestApp({
        identity: { id: OWNER_ID, name: 'Dashboard Owner', avatarUrl: null },
    });
    t.after(() => fixture.database.close());
    await withServer(fixture.app, async (baseUrl) => {
        const login = await signIn(baseUrl);
        assert.equal(login.callback.status, 302);
        assert.ok(login.cookie);

        const replay = await fetch(
            `${baseUrl}/auth/discord/callback?state=${encodeURIComponent(login.state)}&code=test-code`,
            { headers: { cookie: login.preAuthCookie }, redirect: 'manual' },
        );
        assert.equal(replay.status, 400);

        const session = await ownerSession(baseUrl, login.cookie, fixture.config.origin);
        assert.equal(session.user.id, OWNER_ID);

        fixture.setOwnerId(OTHER_ID);
        const revoked = await fetch(`${baseUrl}/api/me`, { headers: { cookie: login.cookie } });
        assert.equal(revoked.status, 403);

        const nonOwnerFixture = createTestApp({
            ownerId: OWNER_ID,
            identity: { id: OTHER_ID, name: 'Not the owner', avatarUrl: null },
        });
        t.after(() => nonOwnerFixture.database.close());
        await withServer(nonOwnerFixture.app, async (nonOwnerBaseUrl) => {
            const denied = await signIn(nonOwnerBaseUrl);
            assert.equal(denied.callback.status, 403);
        });
    });
});

test('owner settings writes require same-origin CSRF and persist versioned audit entries', async (t) => {
    const fixture = createTestApp({
        identity: { id: OWNER_ID, name: 'Dashboard Owner', avatarUrl: null },
    });
    t.after(() => fixture.database.close());
    await withServer(fixture.app, async (baseUrl) => {
        const login = await signIn(baseUrl);
        assert.equal(login.callback.status, 302);
        const { csrfToken } = await ownerSession(baseUrl, login.cookie, fixture.config.origin);
        const overview = await fetch(`${baseUrl}/api/overview`, { headers: { cookie: login.cookie } });
        const overviewBody = await overview.json();
        assert.equal(overview.status, 200);
        assert.equal(Object.hasOwn(overviewBody, 'guilds'), false);
        const guilds = await fetch(`${baseUrl}/api/guilds?page=1`, { headers: { cookie: login.cookie } });
        assert.deepEqual(await guilds.json(), { items: [], total: 0, page: 1, complete: true });
        const commands = await fetch(`${baseUrl}/api/commands`, { headers: { cookie: login.cookie } });
        assert.deepEqual(await commands.json(), { items: [] });
        const headers = {
            cookie: login.cookie,
            origin: fixture.config.origin,
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
        };

        const denied = await fetch(`${baseUrl}/api/settings`, {
            method: 'PATCH',
            headers: { ...headers, origin: 'http://attacker.test' },
            body: JSON.stringify({ version: 0, values: { prefix: '!', botName: 'Bot', color: 'AABBCC' } }),
        });
        assert.equal(denied.status, 403);
        const noToken = await fetch(`${baseUrl}/auth/logout`, {
            method: 'POST',
            headers: { cookie: login.cookie, origin: fixture.config.origin },
        });
        assert.equal(noToken.status, 403);

        const invalid = await fetch(`${baseUrl}/api/settings`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ version: 0, values: { prefix: 'two\nlines', botName: 'Bot', color: '#AABBCC' } }),
        });
        assert.equal(invalid.status, 400);

        const updated = await fetch(`${baseUrl}/api/settings`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ version: 0, values: { prefix: '!', botName: ' Eternality ', color: 'aabbcc' } }),
        });
        assert.equal(updated.status, 200);
        const result = await updated.json();
        assert.deepEqual(result.values, { prefix: '!', botName: 'Eternality', color: 'AABBCC' });
        assert.equal(result.version, 1);

        const conflict = await fetch(`${baseUrl}/api/settings`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ version: 0, values: defaults }),
        });
        assert.equal(conflict.status, 409);

        const reset = await fetch(`${baseUrl}/api/settings`, {
            method: 'DELETE',
            headers,
            body: JSON.stringify({ version: 1 }),
        });
        assert.equal(reset.status, 200);
        assert.equal((await reset.json()).version, 2);

        const audit = await fetch(`${baseUrl}/api/audit`, { headers: { cookie: login.cookie } });
        assert.deepEqual((await audit.json()).items.map(({ action }) => action), ['reset', 'update']);

        const logout = await fetch(`${baseUrl}/auth/logout`, {
            method: 'POST',
            headers: { cookie: login.cookie, origin: fixture.config.origin, 'x-csrf-token': csrfToken },
        });
        assert.equal(logout.status, 204);
    });
});
