require('dotenv').config({ quiet: true });
const { ClusterManager } = require('discord-hybrid-sharding');
const path = require('node:path');
const { DEFAULT_SETTINGS } = require('./services/botSettings');
const { discoverCommandCatalog } = require('./services/commandDiscovery');
const { createSnapshotProvider } = require('./services/snapshotProvider');
const { DashboardDatabase } = require('./storage/database');
const { installManagerIpc } = require('./ipc/manager');
const { loadDashboardConfig } = require('./web/config');
const { createDashboardApp } = require('./web/app');

const manager = new ClusterManager(
    path.join(__dirname, 'index.js'),
    {
        totalShards: 'auto',
        shardsPerClusters: 2,
        totalClusters: 'auto',
        mode: 'process',
        token: process.env.TOKEN,
    },
);

let dashboardDatabase;
let dashboardServer;
let shuttingDown = false;

manager.on('clusterCreate', (cluster) => {
    console.log(`Cluster ${cluster.id} created`);
});

async function shutdown(exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;

    if (dashboardServer?.listening) {
        await new Promise((resolve) => dashboardServer.close(resolve));
    }

    const children = [...manager.clusters.values()]
        .map((cluster) => cluster.thread?.process)
        .filter((child) => child && child.exitCode === null);
    for (const cluster of manager.clusters.values()) {
        if (cluster.thread) cluster.kill({ force: true, reason: 'Manager shutdown' });
    }
    const childExits = children.map((child) => new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
        }
        child.once('exit', resolve);
        child.once('error', resolve);
    }));
    await Promise.race([
        Promise.all(childExits),
        new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);

    dashboardDatabase?.close();
    process.exit(exitCode);
}

process.once('SIGINT', () => void shutdown(0));
process.once('SIGTERM', () => void shutdown(0));

async function start() {
    if (process.env.DASHBOARD_ENABLED === 'true') {
        const dashboardConfig = loadDashboardConfig();
        dashboardDatabase = new DashboardDatabase({
            filename: dashboardConfig.databasePath,
            defaults: DEFAULT_SETTINGS,
        });
        const snapshotProvider = createSnapshotProvider(manager);
        installManagerIpc(manager, { database: dashboardDatabase, snapshotProvider });
        const app = createDashboardApp({
            config: dashboardConfig,
            database: dashboardDatabase,
            snapshotProvider,
            commandCatalog: discoverCommandCatalog(),
        });
        dashboardServer = app.listen(dashboardConfig.port, '127.0.0.1');
        await new Promise((resolve, reject) => {
            dashboardServer.once('listening', resolve);
            dashboardServer.once('error', reject);
        });
    }

    await manager.spawn({ timeout: -1 });
}

start().catch((error) => {
    console.error(`[manager] Startup failed: ${error.message}`);
    void shutdown(1);
});
