const { messageType } = require('discord-hybrid-sharding');
const { captureClient } = require('../dashboardMetrics');
const { readDashboardMessage } = require('./protocol');

async function handleWorkerRequest(client, request) {
    if (request?.getType?.() !== messageType.CUSTOM_REQUEST) return false;
    const message = readDashboardMessage(request);
    if (!message) {
        await request.reply({ type: 'dashboard-error', error: 'Unsupported IPC request' });
        return true;
    }

    const response = message.type === 'snapshot'
        ? { type: 'snapshot-result', snapshot: captureClient(client) }
        : { type: 'settings-request', error: 'Settings must be read by the manager' };
    await request.reply(response);
    return true;
}

function installWorkerIpc(client, { logger = console } = {}) {
    client.cluster.on('message', (request) => {
        void handleWorkerRequest(client, request).catch(() => {
            try {
                logger.warn('[dashboard] Worker IPC request failed.');
            } catch {
                return;
            }
        });
    });
}

module.exports = { handleWorkerRequest, installWorkerIpc };
