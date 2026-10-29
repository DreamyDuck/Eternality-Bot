import { AlertCircle, ArrowLeft, ArrowRight, LoaderCircle, RefreshCw, Server } from 'lucide-react';
import type { ReactNode } from 'react';

export const number = (value: number | null) => value === null ? '—' : value.toLocaleString('zh-CN');
export const memory = (value: number | null) => value === null ? '—' : `${(value / 1024 / 1024).toFixed(1)} MB`;
export function duration(value: number | null) {
  if (value === null) return '—';
  const days = Math.floor(value / 86400);
  const hours = Math.floor(value % 86400 / 3600);
  const minutes = Math.floor(value % 3600 / 60);
  return days ? `${days} 天 ${hours} 小时` : hours ? `${hours} 小时 ${minutes} 分` : `${minutes} 分钟`;
}
export const time = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });

export function Brand() {
  return <div className="brand"><span className="brand-symbol">e<span>·</span></span><div><strong>eternality</strong><small>PRIVATE CONSOLE</small></div></div>;
}
export function Avatar({ name, url, small = false }: { name: string; url?: string | null; small?: boolean }) {
  return <span className={`avatar ${small ? 'small' : ''}`}>{url ? <img src={url} alt="" referrerPolicy="no-referrer" /> : name.slice(0, 1).toUpperCase()}</span>;
}
export function Badge({ good, children }: { good: boolean; children: ReactNode }) {
  return <span className={`badge ${good ? 'good' : 'muted'}`}><span />{children}</span>;
}
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div className={`notice ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}><AlertCircle size={17} /><div>{children}</div></div>;
}
export function Loading() { return <div className="empty"><LoaderCircle className="spin" size={26} /><p>正在连接控制台…</p></div>; }
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><Server size={28} /><h3>{title}</h3>{children && <p>{children}</p>}</div>;
}
export function LoadError({ error, reload }: { error: string; reload: () => void }) {
  return <Notice error>{error} <button className="text-button" onClick={reload}>重新加载</button></Notice>;
}
export function PageHeading({ label, title, description, action }: { label: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{label}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}
export function Refresh({ reload }: { reload: () => void }) { return <button className="button secondary" onClick={reload}><RefreshCw size={15} />刷新数据</button>; }
export function Pagination({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  return <div className="pagination"><span>共 {number(total)} 条 · 第 {page} / {Math.max(1, Math.ceil(total / 20))} 页</span><div><button aria-label="上一页" disabled={page <= 1} onClick={() => onChange(page - 1)}><ArrowLeft size={16} /></button><button aria-label="下一页" disabled={page * 20 >= total} onClick={() => onChange(page + 1)}><ArrowRight size={16} /></button></div></div>;
}
