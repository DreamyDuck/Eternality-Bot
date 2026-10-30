import { Hash, History, Search, Terminal } from 'lucide-react';
import { useState } from 'react';
import type { Audit, Command, Page } from './types';
import { useResource } from './useResource';
import { Empty, LoadError, Loading, PageHeading, Pagination, Refresh, time } from './ui';

export function Commands() {
  const { data, loading, error, reload } = useResource<{ items: Command[] }>('/api/commands');
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const items = data?.items.filter(command => (type === 'all' || command.type === type) && `${command.name} ${command.description} ${command.aliases.join(' ')}`.toLowerCase().includes(query.toLowerCase())) || [];
  return <><PageHeading label="COMMAND LIBRARY" title="每一个指令，都有迹可循。" description="查看 Bot 的命令定义。此目录只读，不执行或启停命令。" action={<Refresh reload={reload} />} /><section className="panel"><div className="toolbar"><div className="tabs" role="group" aria-label="命令类型">{[['all', '全部'], ['slash', 'Slash 命令'], ['message', '消息命令']].map(([value, label]) => <button key={value} aria-pressed={type === value} className={type === value ? 'active' : ''} onClick={() => setType(value)}>{label}</button>)}</div><label className="search"><Search size={16} /><input aria-label="搜索命令" placeholder="搜索命令或别名…" value={query} onChange={event => setQuery(event.target.value)} /></label></div>{error && <LoadError error={error} reload={reload} />}{loading ? <Loading /> : data && (items.length ? <div className="command-grid">{items.map(command => <article className="command-card" key={`${command.type}:${command.name}`}><div className="command-top"><span className="command-icon">{command.type === 'slash' ? <span>/</span> : <Hash size={19} />}</span><span className="tag">{command.type === 'slash' ? 'SLASH' : 'MESSAGE'}</span></div><h3>{command.type === 'slash' ? '/' : ''}{command.name}</h3><p>{command.description || '暂无说明'}</p><div className="command-meta"><Terminal size={12} />{command.category}{command.aliases.length > 0 && <span>别名：{command.aliases.join(', ')}</span>}</div></article>)}</div> : <Empty title="没有匹配的命令">试试其他关键词或命令类型。</Empty>)}</section></>;
}

export function AuditLog() {
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useResource<Page<Audit>>(`/api/audit?page=${page}`);
  return <><PageHeading label="AUDIT LOG" title="每一次改变，都有记录。" description="配置变更的只读记录，不包含 Bot 消息、Token 或原始运行日志。" action={<Refresh reload={reload} />} /><section className="panel"><div className="panel-heading"><div><History size={18} /><h2>配置变更记录</h2></div><span className="tag">READ ONLY</span></div>{error && <LoadError error={error} reload={reload} />}{loading ? <Loading /> : data && (data.items.length ? <><div className="audit-list">{data.items.map(entry => <article className="audit-entry" key={entry.id}><div className="audit-heading"><div><span className="audit-dot" /><strong>{entry.action === 'reset' ? '恢复默认配置' : '更新全局配置'}</strong></div><time dateTime={entry.createdAt}>{time(entry.createdAt)}</time></div><p className="subtle">操作者 <span className="mono">{entry.actorId}</span> · 记录 #{entry.id}</p><div className="audit-changes">{(['prefix', 'botName', 'color'] as const).filter(key => entry.before[key] !== entry.after[key]).map(key => <div key={key}><span>{({ prefix: '命令前缀', botName: '名称触发词', color: '主题色' })[key]}</span><code>{entry.before[key]}</code><span>→</span><code className="new-value">{entry.after[key]}</code></div>)}</div></article>)}</div><Pagination page={page} total={data.total} onChange={setPage} /></> : <Empty title="一切，从这里开始">保存第一项配置后，变更记录就会出现在这里。</Empty>)}</section></>;
}
