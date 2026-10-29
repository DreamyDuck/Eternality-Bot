import { Activity, ArrowUpRight, Box, Cpu, Radio, Server, ShieldCheck, Users } from 'lucide-react';
import { useResource } from './useResource';
import type { Overview as OverviewData } from './types';
import { Avatar, Badge, duration, Empty, LoadError, Loading, memory, Notice, number, PageHeading, Refresh, time } from './ui';

export default function Overview({ navigate }: { navigate: (route: string) => void }) {
  const { data, loading, error, reload } = useResource<OverviewData>('/api/overview', 15000);
  return <>
    <PageHeading label="OVERVIEW" title="一切，尽在掌握。" description="你的 Bot、服务器与运行状态，在这里一目了然。" action={<Refresh reload={reload} />} />
    {error && <LoadError error={error} reload={reload} />}
    {loading && <Loading />}
    {data && <>
      {!data.complete && <Notice>当前为部分数据：{data.respondingClusters} / {data.expectedClusters} 个 cluster 已响应。未就绪进程的数据可能不完整，以下数值不是完整总量。</Notice>}
      <section className="bot-banner">
        <div className="bot-identity"><Avatar name={data.bot?.name || 'E'} url={data.bot?.avatarUrl} /><div><div className="identity-title"><h2>{data.bot?.name || '等待 Bot 连接'}</h2><span className="tag">BOT</span></div><p><Radio size={13} />{data.complete ? '所有进程已就绪' : '等待进程恢复或连接'}<span className="divider-dot">·</span>私有管理空间</p></div></div>
        <Badge good={data.complete}>{data.complete ? '运行正常' : '部分可用 / 未就绪'}</Badge>
      </section>
      <div className="stat-grid">
        <article className="stat-card"><div className="stat-label">服务器{!data.complete && '（已知）'}<Server size={17} /></div><strong>{number(data.totals.guilds)}</strong><button onClick={() => navigate('guilds')}>查看全部服务器<ArrowUpRight size={13} /></button></article>
        <article className="stat-card"><div className="stat-label">成员数合计{!data.totals.membersComplete && '（部分）'}<Users size={17} /></div><strong>{number(data.totals.members)}</strong><p>跨服务器累加，非去重用户数</p></article>
        <article className="stat-card"><div className="stat-label">响应中的 Cluster<Box size={17} /></div><strong>{data.respondingClusters}<small> / {data.expectedClusters}</small></strong><p>实时进程连接状态</p></article>
        <article className="stat-card"><div className="stat-label">进程内存 · RSS<Cpu size={17} /></div><strong className="memory-value">{memory(data.totals.rssBytes)}</strong><p>Manager + 已响应 workers</p></article>
      </div>
      <div className="overview-grid">
        <section className="panel"><div className="panel-heading"><div><Activity size={18} /><h2>集群与分片</h2></div><span className="subtle">每 15 秒更新</span></div>
          {!data.clusters.length ? <Empty title="尚无分片连接">Bot 启动后，运行状态会显示在这里。</Empty> : <div className="cluster-list">{data.clusters.map(cluster => <article className="cluster" key={cluster.id}>
            <div className="cluster-top"><div className="cluster-name"><span className="cluster-icon"><Box size={19} /></span><div><h3>Cluster {cluster.id}</h3><p>运行 {duration(cluster.uptimeSeconds)} · {memory(cluster.rssBytes)}</p></div></div><Badge good={cluster.ready}>{!cluster.available ? '无响应' : cluster.ready ? '已就绪' : '连接中'}</Badge></div>
            <div className="shards">{cluster.shards.map(shard => <div className="shard" key={shard.id}><span className={`status-dot ${shard.status === 'ready' ? 'online' : ''}`} /><span>Shard {shard.id}</span><strong>{shard.pingMs === null ? '—' : `${shard.pingMs} ms`}</strong></div>)}{!cluster.shards.length && <span className="subtle">暂无可用的分片信息</span>}</div>
          </article>)}</div>}
          <div className="panel-footer">最近采样：{time(data.sampledAt)}{error && ' · 数据可能已过期'}</div>
        </section>
        <div className="side-panels"><section className="panel"><div className="panel-heading"><div><Cpu size={18} /><h2>主进程</h2></div></div><dl className="detail-list"><div><dt>运行时长</dt><dd>{duration(data.manager.uptimeSeconds)}</dd></div><div><dt>进程内存</dt><dd>{memory(data.manager.rssBytes)}</dd></div><div><dt>架构</dt><dd>Hybrid Sharding</dd></div><div><dt>采样完整性</dt><dd>{data.complete ? '完整' : '部分数据'}</dd></div></dl></section>
          <section className="security-card"><ShieldCheck size={25} /><h3>只属于你的控制台</h3><p>仅指定的 Discord 账号可以访问。配置修改有记录，敏感凭证不会在这里显示。</p><button className="text-button" onClick={() => navigate('audit')}>查看变更记录<ArrowUpRight size={14} /></button></section>
        </div>
      </div>
    </>}
  </>;
}
