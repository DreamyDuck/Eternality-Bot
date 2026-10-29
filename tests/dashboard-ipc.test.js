const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { messageType } = require('discord-hybrid-sharding');
const { ContainerBuilder } = require('discord.js');
const { DEFAULT_SETTINGS, getAccentColor, getBotSettings } = require('../src/services/botSettings');
const { handleManagerRequest, installManagerIpc } = require('../src/ipc/manager');
const { handleWorkerRequest, installWorkerIpc } = require('../src/ipc/worker');
const { readDashboardMessage } = require('../src/ipc/protocol');
const { createSnapshotProvider, expectedClusterIds } = require('../src/services/snapshotProvider');
const messageCreate = require('../src/events/client/messageCreate');
const { discoverCommandCatalog } = require('../src/services/commandDiscovery');

function createRequest(type, options = {}) {
    let response;
    const request = {
        getType: () => messageType.CUSTOM_REQUEST,
        raw: { type, options },
        reply: async (value) => {
            response = value;
        },
        get response() {
            return response;
        },
    };
    return request;
}

test('dashboard IPC accepts only typed settings and snapshot requests', () => {
    assert.deepEqual(readDashboardMessage({ type: 'settings-read' }), { type: 'settings-read' });
    assert.equal(readDashboardMessage({ type: 'eval', script: 'anything' }), null);
    assert.equal(readDashboardMessage({ type: 'snapshot', options: { timeout: 0 } }), null);
});

test('manager IPC replies to settings and worker snapshot requests', async () => {
    const deps = {
        database: { readSettings: () => ({ values: { prefix: '!', botName: 'bot', color: 'ABCDEF' } }) },
        snapshotProvider: { getSnapshot: async () => ({ complete: true }) },
        logger: { warn() {} },
    };
    const settingsRequest = createRequest('settings-read');
    assert.equal(await handleManagerRequest(settingsRequest, deps), true);
    assert.deepEqual(settingsRequest.response, {
        type: 'settings-result',
        values: { prefix: '!', botName: 'bot', color: 'ABCDEF' },
    });

    const managerEvents = new EventEmitter();
    installManagerIpc(managerEvents, deps);
    const managerSnapshotRequest = createRequest('snapshot');
    managerEvents.emit('clientRequest', managerSnapshotRequest);
    await new Promise(setImmediate);
    assert.deepEqual(managerSnapshotRequest.response, {
        type: 'snapshot-result',
        snapshot: { complete: true },
    });

    const workerClient = {
        cluster: { id: 4, on: EventEmitter.prototype.on },
        isReady: () => true,
        user: null,
        ws: { shards: new Map() },
        guilds: { cache: new Map() },
    };
    const workerRequest = createRequest('snapshot');
    assert.equal(await handleWorkerRequest(workerClient, workerRequest), true);
    assert.equal(workerRequest.response.type, 'snapshot-result');
    assert.equal(workerRequest.response.snapshot.id, 4);
    assert.deepEqual(workerRequest.response.snapshot.guilds, []);

    const workerEvents = new EventEmitter();
    workerClient.cluster = workerEvents;
    workerClient.cluster.id = 5;
    installWorkerIpc(workerClient);
    const eventRequest = createRequest('snapshot');
    workerEvents.emit('message', eventRequest);
    await new Promise(setImmediate);
    assert.equal(eventRequest.response.snapshot.id, 5);
});

test('IPC event listeners contain reply and capture failures without logging request data', async () => {
    const warnings = [];
    const logger = { warn: (message) => warnings.push(message) };
    const managerEvents = new EventEmitter();
    installManagerIpc(managerEvents, { logger });
    const unsupportedRequest = createRequest('eval', { code: 'sensitive payload' });
    unsupportedRequest.reply = async () => {
        throw new Error('reply failure with sensitive payload');
    };
    managerEvents.emit('clientRequest', unsupportedRequest);

    const workerEvents = new EventEmitter();
    const workerClient = {
        cluster: workerEvents,
        isReady: () => true,
        user: null,
        ws: { shards: new Map() },
        guilds: { cache: new Map() },
    };
    installWorkerIpc(workerClient, { logger });
    const workerRequest = createRequest('snapshot');
    workerRequest.reply = async () => {
        throw new Error('reply failure with sensitive payload');
    };
    workerEvents.emit('message', workerRequest);
    await new Promise(setImmediate);

    assert.deepEqual(warnings, [
        '[dashboard] Manager IPC request failed.',
        '[dashboard] Worker IPC request failed.',
    ]);
});

test('settings IPC falls back to source defaults on timeout and color uses normalized settings', async () => {
    const warnings = [];
    const fallback = await getBotSettings(
        { cluster: { request: () => new Promise(() => {}) } },
        {
            enabled: true,
            timeoutMs: 5,
            logger: { warn: (message) => warnings.push(message) },
        },
    );
    assert.deepEqual(fallback, DEFAULT_SETTINGS);
    assert.equal(warnings.length, 1);
    assert.equal(getAccentColor({ color: '12aBcD' }), 0x12abcd);
    assert.equal(getAccentColor({ color: 'bad-color' }), getAccentColor(DEFAULT_SETTINGS));
});

test('Components V2 commands propagate the current dashboard accent color', async () => {
    const command = require('../src/slashCommands/V2 Components/text-display');
    const original = ContainerBuilder.prototype.setAccentColor;
    const appliedColors = [];
    ContainerBuilder.prototype.setAccentColor = function setAccentColor(color) {
        appliedColors.push(color);
        return original.call(this, color);
    };
    try {
        await command.run(null, { reply: async () => null }, undefined, { color: '12AB34' });
    } finally {
        ContainerBuilder.prototype.setAccentColor = original;
    }
    assert.deepEqual(appliedColors, [0x12ab34]);
});

test('bot-only settings never request manager IPC and snapshot IDs include offline clusters', async () => {
    let requests = 0;
    const settings = await getBotSettings({
        cluster: { request: () => { requests += 1; } },
    }, { enabled: false });
    assert.deepEqual(settings, DEFAULT_SETTINGS);
    assert.equal(requests, 0);

    const manager = {
        totalClusters: 3,
        clusterList: [0, 1, 2],
        clusters: new Map([[0, {}]]),
    };
    assert.deepEqual(expectedClusterIds(manager), [0, 1, 2]);
    const provider = createSnapshotProvider(manager, { cacheMs: 5 });
    const snapshot = await provider.getSnapshot();
    assert.equal(snapshot.expectedClusters, 3);
    assert.equal(snapshot.respondingClusters, 0);
});

test('message commands retain prefix, bot-name, and mention triggers with one settings request per human message', async () => {
    const previousEnabled = process.env.DASHBOARD_ENABLED;
    process.env.DASHBOARD_ENABLED = 'true';
    try {
        let requestCount = 0;
        const calls = [];
        const settings = { prefix: '!', botName: 'Eternality', color: '123456' };
        const client = {
            user: { id: '12345' },
            cluster: {
                request: async () => {
                    requestCount += 1;
                    return { type: 'settings-result', values: settings };
                },
            },
            commands: new Map([['ping', {
                run: async (...args) => calls.push(args),
            }]]),
            aliases: new Map(),
        };
        const messages = [
            { content: '!ping alpha', author: { bot: false } },
            { content: 'Eternality ping beta', author: { bot: false } },
            { content: '<@!12345> ping gamma', author: { bot: false } },
            { content: 'no command', author: { bot: false } },
            { content: '!ping ignored', author: { bot: true } },
        ];

        for (const message of messages) await messageCreate.execute(client, message);

        assert.equal(requestCount, 4);
        assert.equal(calls.length, 3);
        assert.deepEqual(calls.map(([, , args]) => args), [['alpha'], ['beta'], ['gamma']]);
        assert.ok(calls.every(([, , , prefix, receivedSettings]) => prefix === '!' && receivedSettings === settings));
    } finally {
        if (previousEnabled === undefined) delete process.env.DASHBOARD_ENABLED;
        else process.env.DASHBOARD_ENABLED = previousEnabled;
    }
});

test('command discovery exposes metadata without importing the bot entrypoint', () => {
    const items = discoverCommandCatalog();
    assert.ok(items.length > 0);
    assert.ok(items.every((item) => (
        Object.keys(item).sort().join(',') === 'aliases,category,description,name,type'
        && ['slash', 'message'].includes(item.type)
        && Array.isArray(item.aliases)
    )));
});
