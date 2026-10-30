import { ArrowLeft, ArrowUpRight, Search } from 'lucide-react';
import { useState } from 'react';
import type { Cluster, Guild, Page } from './types';
import { useResource } from './useResource';
import { Avatar, Badge, Empty, LoadError, Loading, Notice, number, PageHeading, Pagination, Refresh, time } from './ui';

export function Guilds({ navigate }: { navigate: (route: string) => void }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useResource<Page<Guild>>(`/api/guilds?page=${page}&search=${encodeURIComponent(search)}`);
  return <>
    <PageHeading label="SERVERS" title="连接每一个社区。" description="Bot 已加入的服务器。这里的设置由全局配置统一管理。" action={<Refresh reload={reload} />} />
    <section className="panel"><div className="toolbar"><div><h2>服务器列表</h2><span className="subtle">{data ? `${number(data.total)} 个匹配的服务器` : '正在获取服务器'}</span></div><label className="search"><Search size={17} /><input aria-label="搜索服务器" placeholder="搜索名称或服务器 ID…" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label></div>
      {error && <LoadError error={error} reload={reload} />}
      {data?.complete === false && <Notice>部分 cluster 未就绪，列表可能不完整。暂时找不到的服务器并不代表 Bot 已退出。</Notice>}
      {loading ? <Loading /> : data && (data.items.length ? <><div className="table-wrap"><table><thead><tr><th>服务器</th><th>成员数</th><th>所在分片</th><th>可用状态</th><th><span className="sr-only">详情</span></th></tr></thead><tbody>{data.items.map(guild => <tr key={guild.id}><td><div className="table-identity"><Avatar name={guild.name} url={guild.iconUrl} small /><div><strong>{guild.name}</strong><small>{guild.id}</small></div></div></td><td>{number(guild.memberCount)}</td><td><span className="mono">C{guild.clusterId} / S{guild.shardId}</span></td><td><Badge good={guild.available}>{guild.available ? '可用' : '不可用'}</Badge></td><td><button className="icon-button" aria-label={`查看 ${guild.name}`} onClick={() => navigate(`guild/${guild.id}`)}><ArrowUpRight size={18} /></button></td></tr>)}</tbody></table></div><Pagination page={page} total={data.total} onChange={setPage} /></> : <Empty title={search ? '没有匹配的服务器' : '暂无服务器'}>{search ? '换个关键词试试。' : 'Bot 加入服务器后会自动出现在这里。'}</Empty>)}
    </section>
  </>;
}

export function GuildDetail({ id, navigate }: { id: string; navigate: (route: string) => void }) {
  const { data, loading, error, reload } = useResource<{ guild: Guild; cluster: Cluster; sampledAt: string }>(`/api/guilds/${encodeURIComponent(id)}/overview`, 15000);
  return <><button className="back-button" onClick={() => navigate('guilds')}><ArrowLeft size={16} />返回服务器列表</button><PageHeading label="SERVER DETAILS" title={data?.guild.name || '服务器详情'} description="只读查看服务器与分片状态。" action={<Refresh reload={reload} />} />{error && <LoadError error={error} reload={reload} />}{loading && <Loading />}{data && <section className="panel"><div className="toolbar"><div className="table-identity"><Avatar name={data.guild.name} url={data.guild.iconUrl} /><h2>{data.guild.name}</h2></div><Badge good={data.guild.available && data.cluster.ready}>{data.guild.available && data.cluster.ready ? '连接正常' : '未就绪'}</Badge></div><dl className="detail-list"><div><dt>服务器 ID</dt><dd className="mono">{data.guild.id}</dd></div><div><dt>成员数</dt><dd>{number(data.guild.memberCount)}</dd></div><div><dt>Cluster / Shard</dt><dd>{data.guild.clusterId} / {data.guild.shardId}</dd></div><div><dt>最近采样</dt><dd>{time(data.sampledAt)}</dd></div></dl><div className="panel-footer">命令前缀和主题色使用 <button className="text-button" onClick={() => navigate('settings')}>全局设置</button>，不提供服务器单独覆盖。</div></section>}</>;
}
