const { test } = require('node:test');
const assert = require('node:assert/strict');
const { aggregateSnapshots, captureClient } = require('../src/dashboardMetrics');

test('deduplicates guilds during migration and counts each process RSS once', () => {
    const guild = { id: '10', name: 'One', memberCount: 7, available: true };
    const samples = [
        { id: 0, ready: true, uptimeSeconds: 20, rssBytes: 100, bot: null, guilds: [guild], shards: [{ id: 0 }, { id: 1 }] },
        { id: 1, ready: true, uptimeSeconds: 30, rssBytes: 200, bot: { name: 'Bot' }, guilds: [guild, { ...guild, id: '11', name: 'Two', memberCount: 3 }], shards: [{ id: 2 }, { id: 3 }] },
    ];
    const result = aggregateSnapshots([0, 1], samples, { uptimeSeconds: 40, rssBytes: 50 });
    assert.equal(result.complete, true);
    assert.deepEqual(result.totals, { guilds: 2, members: 10, membersComplete: true, rssBytes: 350 });
    assert.equal(result.respondingClusters, 2);
});

test('missing or unready clusters and unknown members are explicitly incomplete', () => {
    const result = aggregateSnapshots([0, 1], [{
        id: 0, ready: true, uptimeSeconds: 20, rssBytes: 100, bot: null,
        guilds: [{ id: '10', name: 'Unavailable', memberCount: null, available: false }], shards: [],
    }], { uptimeSeconds: 40, rssBytes: 50 });
    assert.equal(result.complete, false);
    assert.equal(result.totals.membersComplete, false);
    assert.equal(result.expectedClusters, 2);
    assert.equal(result.respondingClusters, 1);
    assert.equal(result.clusters[1].available, false);
    assert.equal(result.clusters[1].rssBytes, null);
    assert.equal(aggregateSnapshots([], [], { uptimeSeconds: 0, rssBytes: 1 }).complete, false);
});

test('worker sample does not expose unknown latency or unavailable member count as valid', () => {
    const result = captureClient({
        cluster: { id: 2 }, isReady: () => false, user: null,
        ws: { shards: new Map([[4, { id: 4, status: 1, ping: -1 }]]) },
        guilds: { cache: new Map([['10', { id: '10', name: 'Guild', available: false, memberCount: 200, shardId: 4, iconURL: () => null }]]) },
    });
    assert.equal(result.id, 2);
    assert.equal(result.shards[0].pingMs, null);
    assert.equal(result.shards[0].status, 'connecting');
    assert.equal(result.guilds[0].memberCount, null);
});
