const { messageType } = require('discord-hybrid-sharding');
const { readDashboardMessage } = require('./protocol');

function warn(logger, message) {
    try {
        logger.warn(message);
    } catch {
        return;
    }
}

async function handleManagerRequest(request, dependencies = {}) {
    const { database, snapshotProvider, logger = console } = dependencies;
    try {
        if (request?.getType?.() !== messageType.CUSTOM_REQUEST) return false;
        const message = readDashboardMessage(request);
        if (!message) {
            await request.reply({ type: 'dashboard-error', error: 'Unsupported IPC request' });
            return true;
        }

        let response;
        if (message.type === 'settings-read') {
            response = { type: 'settings-result', values: database.readSettings().values };
        } else {
            response = { type: 'snapshot-result', snapshot: await snapshotProvider.getSnapshot() };
        }
        await request.reply(response);
    } catch {
        warn(logger, '[dashboard] Manager IPC request failed.');
        try {
            await request.reply({ type: 'dashboard-error', error: 'Dashboard IPC request failed' });
        } catch {
            return true;
        }
    }
    return true;
}

function installManagerIpc(manager, dependencies) {
    manager.on('clientRequest', (request) => {
        void handleManagerRequest(request, dependencies).catch(() => {
            warn(dependencies?.logger ?? console, '[dashboard] Manager IPC request failed.');
        });
    });
}

module.exports = { handleManagerRequest, installManagerIpc };
