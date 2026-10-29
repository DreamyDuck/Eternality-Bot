const { aggregateSnapshots } = require('../dashboardMetrics');
const { IPC_TIMEOUT_MS, withTimeout } = require('../ipc/protocol');

function expectedClusterIds(manager) {
    const ids = new Set();
    if (Number.isInteger(manager.totalClusters) && manager.totalClusters > 0) {
        for (let id = 0; id < manager.totalClusters; id += 1) ids.add(id);
    } else if (Array.isArray(manager.clusterList)) {
        for (const id of manager.clusterList) {
            if (Number.isInteger(id) && id >= 0) ids.add(id);
        }
    }
    for (const id of manager.clusters.keys()) {
        if (Number.isInteger(Number(id)) && Number(id) >= 0) ids.add(Number(id));
    }
    return [...ids].sort((a, b) => a - b);
}

function createSnapshotProvider(manager, { timeoutMs = IPC_TIMEOUT_MS, cacheMs = 5000 } = {}) {
    let cachedSnapshot = null;
    let cachedAt = 0;
    let inflight = null;

    async function collect() {
        const ids = expectedClusterIds(manager);
        const snapshots = await Promise.all(ids.map(async (id) => {
            const cluster = manager.clusters.get(id);
            if (!cluster || !cluster.thread || typeof cluster.request !== 'function') return null;
            try {
                const result = await withTimeout(
                    cluster.request({
                        type: 'snapshot',
                        options: { timeout: timeoutMs },
                    }),
                    timeoutMs,
                );
                if (result?.type !== 'snapshot-result'
                    || result.snapshot?.id !== id
                    || !Array.isArray(result.snapshot.guilds)
                    || !Array.isArray(result.snapshot.shards)) {
                    return null;
                }
                return result.snapshot;
            } catch {
                return null;
            }
        }));

        return aggregateSnapshots(ids, snapshots.filter(Boolean), {
            uptimeSeconds: Math.floor(process.uptime()),
            rssBytes: process.memoryUsage().rss,
        });
    }

    return {
        getSnapshot() {
            if (cachedSnapshot && Date.now() - cachedAt < cacheMs) return Promise.resolve(cachedSnapshot);
            if (inflight) return inflight;
            inflight = collect()
                .then((snapshot) => {
                    cachedSnapshot = snapshot;
                    cachedAt = Date.now();
                    return snapshot;
                })
                .finally(() => {
                    inflight = null;
                });
            return inflight;
        },
    };
}

module.exports = { createSnapshotProvider, expectedClusterIds };
