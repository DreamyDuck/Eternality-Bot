const session = require('express-session');

class DashboardSessionStore extends session.Store {
    constructor(database, maxAgeMs) {
        super();
        this.database = database;
        this.maxAgeMs = maxAgeMs;
    }

    get(sid, callback) {
        try {
            callback(null, this.database.readSession(sid));
        } catch (error) {
            callback(error);
        }
    }

    set(sid, value, callback = () => {}) {
        try {
            this.database.saveSession(sid, value, this.maxAgeMs);
            callback(null);
        } catch (error) {
            callback(error);
        }
    }

    destroy(sid, callback = () => {}) {
        try {
            this.database.deleteSession(sid);
            callback(null);
        } catch (error) {
            callback(error);
        }
    }

    touch(sid, value, callback = () => {}) {
        try {
            this.database.touchSession(sid, value, this.maxAgeMs);
            callback(null);
        } catch (error) {
            callback(error);
        }
    }
}

module.exports = { DashboardSessionStore };
