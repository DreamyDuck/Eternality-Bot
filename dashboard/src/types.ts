export interface User { id: string; name: string; avatarUrl: string | null }
export interface Shard { id: number; status: string; pingMs: number | null }
export interface Cluster {
  id: number; available: boolean; ready: boolean;
  uptimeSeconds: number | null; rssBytes: number | null; shards: Shard[];
}
export interface Guild {
  id: string; name: string; iconUrl: string | null; memberCount: number | null;
  shardId: number; clusterId: number; available: boolean;
}
export interface Overview {
  bot: { id: string; name: string; avatarUrl: string | null } | null;
  sampledAt: string; complete: boolean; expectedClusters: number; respondingClusters: number;
  totals: { guilds: number; members: number; membersComplete: boolean; rssBytes: number };
  manager: { uptimeSeconds: number; rssBytes: number }; clusters: Cluster[];
}
export interface Values { prefix: string; botName: string; color: string }
export interface Settings { values: Values; defaults: Values; version: number }
export interface Command { name: string; description: string; type: 'slash' | 'message'; category: string; aliases: string[] }
export interface Audit { id: number; createdAt: string; actorId: string; action: 'update' | 'reset'; before: Values; after: Values }
export interface Page<T> { items: T[]; total: number; page: number; complete?: boolean }
