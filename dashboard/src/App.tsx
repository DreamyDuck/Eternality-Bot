import { Activity, ArrowRight, ChevronRight, Command, Globe, History, LayoutDashboard, LockKeyhole, LogOut, Menu, Settings2, ShieldCheck, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, setCsrfToken } from './api';
import type { User } from './types';
import { Avatar, Brand, Loading, Notice } from './ui';
import Overview from './Overview';
import { GuildDetail, Guilds } from './Guilds';
import Settings from './Settings';
import { AuditLog, Commands } from './Directory';

const navigation = [
  { id: 'overview', label: '全局概览', icon: LayoutDashboard },
  { id: 'guilds', label: '服务器', icon: Globe },
  { id: 'settings', label: '全局设置', icon: Settings2 },
  { id: 'commands', label: '命令目录', icon: Command },
  { id: 'audit', label: '变更记录', icon: History },
];
function readRoute() {
  const value = window.location.hash.slice(1);
  return navigation.some(item => item.id === value) || /^guild\/\d+$/.test(value) ? value : 'overview';
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginError, setLoginError] = useState('');
  const [route, setRoute] = useState(readRoute);
  const [dirty, setDirty] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const loadSession = useCallback(async () => {
    setLoading(true); setLoginError('');
    try {
      const result = await api<{ user: User; csrfToken: string }>('/api/me');
      setCsrfToken(result.csrfToken); setUser(result.user);
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 401) setLoginError(err instanceof ApiError && err.status === 403 ? '该账号不在允许名单中。请使用配置的 owner 账号登录。' : '控制台暂时无法连接，请确认 Web 服务已启动后重试。');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadSession(); }, [loadSession]);
  useEffect(() => {
    const expired = () => { if (!user) return; setUser(null); setCsrfToken(''); setDirty(false); setLoginError('登录已过期或访问权限已变更，请重新登录。'); };
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, [user]);
  useEffect(() => {
    const hashChange = () => {
      const next = readRoute();
      if (next === route) return;
      if (dirty && !window.confirm('你有未保存的修改，确定离开吗？')) { window.history.replaceState(null, '', `#${route}`); return; }
      setDirty(false); setRoute(next); setMobileOpen(false);
    };
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('hashchange', hashChange);
    window.addEventListener('beforeunload', beforeUnload);
    return () => { window.removeEventListener('hashchange', hashChange); window.removeEventListener('beforeunload', beforeUnload); };
  }, [route, dirty]);
  function navigate(next: string) { window.location.hash = next; }
  async function logout() {
    if (dirty && !window.confirm('退出将丢弃未保存的修改，是否继续？')) return;
    setLoggingOut(true); setLogoutError('');
    try { await api('/auth/logout', { method: 'POST', body: '{}' }); setUser(null); setCsrfToken(''); setDirty(false); }
    catch { setLogoutError('退出失败，请重试。'); }
    finally { setLoggingOut(false); }
  }
  if (loading) return <div className="startup"><Brand /><Loading /></div>;
  if (!user) return <div className="login-page"><header><Brand /><span className="login-private"><LockKeyhole size={14} />仅限所有者</span></header><main className="login-layout"><section className="login-intro"><div className="eyebrow">YOUR BOT. YOUR SPACE.</div><h1>无限可能。<br /><span>由你掌控。</span></h1><p>为 Eternality 打造的私人控制台。<br />连接你的 Bot，让每一个运行细节清晰可见。</p><div className="login-features"><span><Activity size={17} />实时运行状态</span><span><Settings2 size={17} />统一配置管理</span><span><ShieldCheck size={17} />仅所有者访问</span></div><div className="orbit-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit-center">e·</div><span className="orbit-star one" /><span className="orbit-star two" /><span className="orbit-star three" /></div></section><section className="login-card"><div className="login-lock"><LockKeyhole size={25} /></div><h2>欢迎回到控制台</h2><p>使用你的 Discord 账号安全登录。</p>{loginError && <Notice error>{loginError}<button className="text-button" onClick={() => void loadSession()}>重试连接</button></Notice>}{new URLSearchParams(window.location.search).has('error') && <Notice error>Discord 登录未完成。请确认使用 owner 账号后重试。</Notice>}<a className="button primary login-button" href="/auth/discord"><DiscordIcon />使用 Discord 登录<ArrowRight size={18} /></a><div className="login-rule" /><div className="login-security"><ShieldCheck size={18} /><p>此控制台不对外开放。只有服务端配置的 Discord 用户 ID 可以访问；服务器管理员权限不授予后台访问权。</p></div><span className="login-caption">不读取私人消息 · 不申请服务器管理权限</span></section></main><footer>ETERNALITY <span>一个 Bot，一个专属控制台。</span><span>OWNER ACCESS ONLY</span></footer></div>;
  const current = navigation.find(item => item.id === route) || navigation[1];
  return <div className="app-shell"><a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>跳转到内容</a>{mobileOpen && <button className="sidebar-backdrop" aria-label="关闭导航" onClick={() => setMobileOpen(false)} />}<aside className={`sidebar ${mobileOpen ? 'open' : ''}`}><div className="sidebar-brand"><Brand /><button className="mobile-only icon-button" aria-label="关闭菜单" onClick={() => setMobileOpen(false)}><X size={20} /></button></div><div className="workspace"><span className="workspace-icon"><LockKeyhole size={16} /></span><div><strong>私人工作空间</strong><small>Owner workspace</small></div><ShieldCheck size={15} /></div><div className="nav-label">WORKSPACE</div><nav aria-label="主导航">{navigation.map(item => <button key={item.id} className={route === item.id || (route.startsWith('guild/') && item.id === 'guilds') ? 'active' : ''} aria-current={route === item.id || (route.startsWith('guild/') && item.id === 'guilds') ? 'page' : undefined} onClick={() => navigate(item.id)}><item.icon size={18} />{item.label}<ChevronRight className="nav-chevron" size={14} /></button>)}</nav><div className="sidebar-bottom"><div className="private-note"><ShieldCheck size={16} /><span>私有部署 · 安全访问</span></div><div className="user-card"><Avatar name={user.name} url={user.avatarUrl} small /><div><strong>{user.name}</strong><small>控制台所有者</small></div><button className="icon-button" aria-label="退出登录" disabled={loggingOut} onClick={() => void logout()}><LogOut size={17} /></button></div></div></aside><div className="app-main"><header className="topbar"><div><button className="mobile-only icon-button" aria-label="打开菜单" onClick={() => setMobileOpen(true)}><Menu size={20} /></button><span className="breadcrumb">工作空间</span><ChevronRight size={13} /><strong>{current.label}</strong></div><span className="owner-badge"><LockKeyhole size={12} />OWNER ONLY</span></header><main id="main-content" tabIndex={-1} className="main-content">{logoutError && <Notice error>{logoutError}</Notice>}{route === 'overview' && <Overview navigate={navigate} />}{route === 'guilds' && <Guilds navigate={navigate} />}{route.startsWith('guild/') && <GuildDetail id={route.slice(6)} navigate={navigate} />}{route === 'settings' && <Settings onDirty={setDirty} />}{route === 'commands' && <Commands />}{route === 'audit' && <AuditLog />}</main><footer className="app-footer"><span>Eternality Console</span><span>仅所有者可见 <LockKeyhole size={11} /></span></footer></div></div>;
}

function DiscordIcon() {
  return <svg width="21" height="18" viewBox="0 0 24 20" fill="currentColor" aria-hidden="true"><path d="M20.3 1.7a20 20 0 0 0-4.9-1.5l-.6 1.2a18 18 0 0 0-5.6 0L8.6.2a20 20 0 0 0-4.9 1.5C.6 6.3-.2 10.8.2 15.2a20 20 0 0 0 6 3l1.2-2a12 12 0 0 1-1.9-.9l.5-.4a14 14 0 0 0 12 0l.5.4-1.9.9 1.2 2a20 20 0 0 0 6-3c.5-5.1-.8-9.6-3.5-13.5ZM8.2 12.5c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.1 1.1 2.1 2.4-.9 2.4-2.1 2.4Zm7.6 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.1 1.1 2.1 2.4-.9 2.4-2.1 2.4Z" /></svg>;
}
