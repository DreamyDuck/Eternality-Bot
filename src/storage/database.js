const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const SETTINGS_FIELDS = ['prefix', 'botName', 'color'];

class SettingsConflictError extends Error {
    constructor(currentVersion) {
        super('Settings version conflict');
        this.name = 'SettingsConflictError';
        this.currentVersion = currentVersion;
    }
}

function effectiveSettings(defaults, overrides) {
    return { ...defaults, ...overrides };
}

class DashboardDatabase {
    constructor({ filename, defaults }) {
        if (!filename) throw new Error('A dashboard database path is required');
        if (filename !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });

        this.defaults = { ...defaults };
        this.database = new Database(filename);
        this.database.pragma('journal_mode = WAL');
        this.database.pragma('busy_timeout = 5000');
        this.migrate();
        this.nextSessionCleanupAt = null;
        this.pruneExpiredSessions();
    }

    migrate() {
        const currentVersion = this.database.pragma('user_version', { simple: true });
        if (currentVersion > 1) throw new Error('Dashboard database schema is newer than this application');
        if (currentVersion === 1) return;

        this.database.transaction(() => {
            this.database.exec(`
                CREATE TABLE dashboard_settings (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    overrides TEXT NOT NULL,
                    version INTEGER NOT NULL CHECK (version >= 0)
                );
                INSERT INTO dashboard_settings (id, overrides, version) VALUES (1, '{}', 0);

                CREATE TABLE dashboard_sessions (
                    sid TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    expires_at INTEGER NOT NULL
                );
                CREATE INDEX dashboard_sessions_expires_at ON dashboard_sessions (expires_at);

                CREATE TABLE dashboard_oauth_states (
                    state_hash TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    expires_at INTEGER NOT NULL
                );

                CREATE TABLE dashboard_audit (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at TEXT NOT NULL,
                    actor_id TEXT NOT NULL,
                    action TEXT NOT NULL CHECK (action IN ('update', 'reset')),
                    before_values TEXT NOT NULL,
                    after_values TEXT NOT NULL
                );
            `);
            this.database.pragma('user_version = 1');
        })();
    }

    readSettings() {
        const row = this.database.prepare(
            'SELECT overrides, version FROM dashboard_settings WHERE id = 1',
        ).get();
        const overrides = JSON.parse(row.overrides);
        return {
            values: effectiveSettings(this.defaults, overrides),
            defaults: { ...this.defaults },
            version: row.version,
        };
    }

    updateSettings({ version, values, actorId, action = 'update' }) {
        if (!['update', 'reset'].includes(action)) throw new Error('Invalid settings action');
        const update = this.database.transaction(() => {
            const row = this.database.prepare(
                'SELECT overrides, version FROM dashboard_settings WHERE id = 1',
            ).get();
            if (row.version !== version) throw new SettingsConflictError(row.version);

            const before = effectiveSettings(this.defaults, JSON.parse(row.overrides));
            const after = action === 'reset' ? { ...this.defaults } : { ...values };
            const overrides = {};
            for (const field of SETTINGS_FIELDS) {
                if (after[field] !== this.defaults[field]) overrides[field] = after[field];
            }

            const nextVersion = row.version + 1;
            this.database.prepare(
                'UPDATE dashboard_settings SET overrides = ?, version = ? WHERE id = 1',
            ).run(JSON.stringify(overrides), nextVersion);
            this.database.prepare(`
                INSERT INTO dashboard_audit (created_at, actor_id, action, before_values, after_values)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                new Date().toISOString(),
                actorId,
                action,
                JSON.stringify(before),
                JSON.stringify(after),
            );

            return { values: after, defaults: { ...this.defaults }, version: nextVersion };
        });
        return update();
    }

    readAudit(page, pageSize = 20) {
        const total = this.database.prepare('SELECT COUNT(*) AS total FROM dashboard_audit').get().total;
        const rows = this.database.prepare(`
            SELECT id, created_at, actor_id, action, before_values, after_values
            FROM dashboard_audit
            ORDER BY id DESC
            LIMIT ? OFFSET ?
        `).all(pageSize, (page - 1) * pageSize);
        return {
            items: rows.map((row) => ({
                id: row.id,
                createdAt: row.created_at,
                actorId: row.actor_id,
                action: row.action,
                before: JSON.parse(row.before_values),
                after: JSON.parse(row.after_values),
            })),
            total,
            page,
        };
    }

    pruneExpiredSessions() {
        const now = Date.now();
        if (this.nextSessionCleanupAt !== null && now < this.nextSessionCleanupAt) return;

        this.database.prepare(
            'DELETE FROM dashboard_sessions WHERE expires_at <= ?',
        ).run(now);
        this.nextSessionCleanupAt = now + 60_000;
    }

    saveSession(sid, session, maxAgeMs) {
        this.pruneExpiredSessions();
        const cookieExpiry = session.cookie?.expires
            ? new Date(session.cookie.expires).getTime()
            : Date.now() + maxAgeMs;
        const expiry = Math.min(cookieExpiry, session.absoluteExpiresAt || cookieExpiry);
        this.database.prepare(`
            INSERT INTO dashboard_sessions (sid, data, expires_at)
            VALUES (?, ?, ?)
            ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at
        `).run(sid, JSON.stringify(session), expiry);
    }

    readSession(sid) {
        const row = this.database.prepare(
            'SELECT data, expires_at FROM dashboard_sessions WHERE sid = ?',
        ).get(sid);
        if (!row) return null;
        if (row.expires_at <= Date.now()) {
            this.deleteSession(sid);
            return null;
        }
        return JSON.parse(row.data);
    }

    touchSession(sid, session, maxAgeMs) {
        this.pruneExpiredSessions();
        const cookieExpiry = session.cookie?.expires
            ? new Date(session.cookie.expires).getTime()
            : Date.now() + maxAgeMs;
        const expiry = Math.min(cookieExpiry, session.absoluteExpiresAt || cookieExpiry);
        this.database.prepare(
            'UPDATE dashboard_sessions SET expires_at = ? WHERE sid = ?',
        ).run(expiry, sid);
    }

    deleteSession(sid) {
        this.database.prepare('DELETE FROM dashboard_sessions WHERE sid = ?').run(sid);
    }

    saveOAuthState(stateHash, sessionId, expiresAt) {
        this.database.prepare('DELETE FROM dashboard_oauth_states WHERE expires_at <= ?').run(Date.now());
        this.database.prepare(`
            INSERT INTO dashboard_oauth_states (state_hash, session_id, expires_at)
            VALUES (?, ?, ?)
        `).run(stateHash, sessionId, expiresAt);
    }

    consumeOAuthState(stateHash, sessionId) {
        return this.database.transaction(() => {
            const row = this.database.prepare(
                'SELECT session_id, expires_at FROM dashboard_oauth_states WHERE state_hash = ?',
            ).get(stateHash);
            if (!row) return null;
            if (row.expires_at <= Date.now()) {
                this.database.prepare('DELETE FROM dashboard_oauth_states WHERE state_hash = ?').run(stateHash);
                return null;
            }
            if (sessionId !== undefined && row.session_id !== sessionId) return null;
            this.database.prepare('DELETE FROM dashboard_oauth_states WHERE state_hash = ?').run(stateHash);
            return { sessionId: row.session_id, expiresAt: row.expires_at };
        })();
    }

    close() {
        if (this.database.open) this.database.close();
    }
}

module.exports = { DashboardDatabase, SettingsConflictError };
