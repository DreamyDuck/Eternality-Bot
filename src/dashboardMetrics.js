function captureClient(client) {
    return {
        id: client.cluster.id,
        ready: client.isReady(),
        uptimeSeconds: Math.floor(process.uptime()),
        rssBytes: process.memoryUsage().rss,
        bot: client.user ? {
            id: client.user.id,
            name: client.user.username,
            avatarUrl: client.user.displayAvatarURL({ size: 128 }),
        } : null,
        shards: [...client.ws.shards.values()].map(shard => ({
            id: shard.id,
            status: shard.status === 0 ? 'ready' : 'connecting',
            pingMs: Number.isFinite(shard.ping) && shard.ping >= 0 ? shard.ping : null,
        })),
        guilds: [...client.guilds.cache.values()].map(guild => ({
            id: guild.id,
            name: guild.name,
            iconUrl: guild.iconURL({ size: 64 }),
            memberCount: guild.available && Number.isFinite(guild.memberCount) ? guild.memberCount : null,
            shardId: guild.shardId,
            clusterId: client.cluster.id,
            available: guild.available,
        })),
    };
}

function aggregateSnapshots(expectedIds, samples, manager, sampledAt = new Date().toISOString()) {
    const ids = [...new Set(expectedIds)];
    const byCluster = new Map(samples.filter(Boolean).map(sample => [sample.id, sample]));
    const guilds = new Map();
    let bot = null;
    const clusters = ids.map(id => {
        const sample = byCluster.get(id);
        if (!sample) return { id, available: false, ready: false, uptimeSeconds: null, rssBytes: null, shards: [] };
        if (sample.bot) bot = sample.bot;
        for (const guild of sample.guilds) {
            const previous = guilds.get(guild.id);
            if (!previous || (!previous.available && guild.available)) guilds.set(guild.id, guild);
        }
        return {
            id, available: true, ready: sample.ready,
            uptimeSeconds: sample.uptimeSeconds,
            rssBytes: sample.rssBytes,
            shards: sample.shards,
        };
    });
    const respondingClusters = clusters.filter(cluster => cluster.available).length;
    const complete = ids.length > 0 && clusters.every(cluster => cluster.available && cluster.ready);
    const guildList = [...guilds.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return {
        bot, sampledAt, complete,
        expectedClusters: ids.length,
        respondingClusters,
        totals: {
            guilds: guildList.length,
            members: guildList.reduce((sum, guild) => sum + (guild.memberCount ?? 0), 0),
            membersComplete: complete && guildList.every(guild => guild.memberCount !== null),
            rssBytes: manager.rssBytes + clusters.reduce((sum, cluster) => sum + (cluster.rssBytes ?? 0), 0),
        },
        manager,
        clusters,
        guilds: guildList,
    };
}

module.exports = { captureClient, aggregateSnapshots };
