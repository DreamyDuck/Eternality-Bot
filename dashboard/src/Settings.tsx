import { Check, Globe, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import type { Settings as SettingsData, Values } from './types';
import { useResource } from './useResource';
import { LoadError, Loading, Notice, PageHeading } from './ui';

const same = (a: Values, b: Values) => a.prefix === b.prefix && a.botName === b.botName && a.color === b.color;
export default function Settings({ onDirty }: { onDirty: (dirty: boolean) => void }) {
  const { data, error, loading, reload, setData } = useResource<SettingsData>('/api/settings');
  const [values, setValues] = useState<Values>({ prefix: '', botName: '', color: '000000' });
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState('');
  const [conflict, setConflict] = useState(false);
  const [success, setSuccess] = useState(false);
  const [confirm, setConfirm] = useState<'update' | 'reset' | null>(null);
  const dirty = !!data && !same(values, data.values);
  useEffect(() => { if (data) setValues(data.values); }, [data]);
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  useEffect(() => {
    if (!confirm) return;
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) setConfirm(null); };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [confirm, saving]);
  function change(key: keyof Values, value: string) { setValues(current => ({ ...current, [key]: value })); setSuccess(false); }
  async function save() {
    if (!data || !confirm) return;
    setSaving(true); setFailure(''); setSuccess(false); setConflict(false);
    try {
      const result = await api<SettingsData>('/api/settings', {
        method: confirm === 'reset' ? 'DELETE' : 'PATCH',
        body: JSON.stringify({ version: data.version, ...(confirm === 'update' ? { values } : {}) }),
      });
      setData(result); setValues(result.values); setSuccess(true);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : '保存失败，请重试');
      setConflict(err instanceof ApiError && err.status === 409);
    } finally { setSaving(false); setConfirm(null); }
  }
  function discard() {
    if (dirty && !window.confirm('重新加载将丢弃未保存的修改，是否继续？')) return;
    setFailure(''); setConflict(false); setSuccess(false); reload();
  }
  return <>
    <PageHeading label="CONFIGURATION" title="让 Bot，听你的。" description="一处配置，所有服务器统一生效。无需重新启动 Bot。" />
    {error && <LoadError error={error} reload={reload} />}
    {loading && <Loading />}
    {data && <>
      <Notice>全局配置：以下修改影响 Bot 所在的所有服务器。离线进程恢复后会读取最新配置。</Notice>
      {failure && <Notice error>{conflict ? '配置已被另一个页面修改。请重新加载最新配置后再保存。' : failure}{conflict && <button className="text-button" onClick={discard}>重新加载配置</button>}</Notice>}
      {success && <div className="success-message" role="status"><Check size={17} />配置已持久保存。正常连接的进程将在下一次命令处理中读取新配置。</div>}
      <form onSubmit={event => { event.preventDefault(); setConfirm('update'); }}>
        <div className="settings-grid"><section className="panel"><div className="panel-heading"><div><Globe size={18} /><h2>基础设置</h2></div><span className="tag">GLOBAL</span></div><div className="form-content">
          <label className="field"><span id="prefix-label">命令前缀</span><input aria-labelledby="prefix-label" aria-describedby="prefix-help" required maxLength={32} value={values.prefix} onChange={event => change('prefix', event.target.value)} placeholder="?" disabled={saving} /><small id="prefix-help">消息命令的触发前缀，例如 <code>?ping</code>。1–32 个字符。</small></label>
          <label className="field"><span id="bot-name-label">名称触发词</span><input aria-labelledby="bot-name-label" aria-describedby="bot-name-help" required maxLength={32} value={values.botName} onChange={event => change('botName', event.target.value)} placeholder="zar" disabled={saving} /><small id="bot-name-help">例如 <code>zar ping</code>。这不会修改 Discord 用户名或服务器昵称。</small></label>
          <div className="field"><label htmlFor="theme-color">消息主题色</label><div className="color-input"><input type="color" aria-label="选择消息主题色" value={/^[0-9a-f]{6}$/i.test(values.color) ? `#${values.color}` : '#000000'} onChange={event => change('color', event.target.value.slice(1).toUpperCase())} disabled={saving} /><span>#</span><input id="theme-color" required pattern="[0-9a-fA-F]{6}" maxLength={6} value={values.color} onChange={event => change('color', event.target.value.toUpperCase())} disabled={saving} /></div><small>6 位十六进制颜色，用于 Bot 回复和 Components V2 的强调色。</small></div>
        </div><div className="settings-actions"><button type="button" className="button secondary" onClick={() => setConfirm('reset')} disabled={saving}><RotateCcw size={15} />恢复默认</button><div><span className="subtle">{dirty ? '有未保存的修改' : `当前版本 v${data.version}`}</span><button className="button primary" type="submit" disabled={!dirty || saving || conflict}><Save size={15} />保存修改</button></div></div></section>
        <aside><section className="panel preview-panel"><div className="panel-heading"><div><h2>回复样式预览</h2></div><span className="tag">PREVIEW</span></div><div className="message-preview"><div className="preview-avatar">e·</div><div className="preview-body"><strong>Eternality <span className="tag">APP</span></strong><span className="subtle">示例消息 · 非实时数据</span><div className="discord-message" style={{ borderLeftColor: /^[0-9a-f]{6}$/i.test(values.color) ? `#${values.color}` : '#000000' }}><h3>Pong!</h3><p>你的 Bot 已准备就绪。</p><code>{values.prefix || '?'}ping</code></div></div></div></section><div className="settings-note"><ShieldCheck size={20} /><div><strong>安全地修改配置</strong><p>每次保存和重置都会记录变更。Bot Token 和登录凭证不支持在 Web 页面编辑。</p></div></div></aside></div>
      </form>
    </>}
    {confirm && <div className="modal-backdrop"><section role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description" className="modal" onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      if (!buttons.length) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[buttons.length - 1].focus(); }
      if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) { event.preventDefault(); buttons[0].focus(); }
    }}><div className="modal-icon"><Globe size={25} /></div><h2 id="confirm-title">{confirm === 'reset' ? '恢复全局默认配置？' : '应用到所有服务器？'}</h2><p id="confirm-description">{confirm === 'reset' ? `前缀将恢复为「${data?.defaults.prefix}」，触发词为「${data?.defaults.botName}」，主题色为 #${data?.defaults.color}。` : '这些修改将统一影响 Bot 所在的所有服务器，包括消息命令的触发方式。'}此操作将写入变更记录。</p><div className="modal-actions"><button autoFocus className="button secondary" disabled={saving} onClick={() => setConfirm(null)}>取消</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? '正在保存…' : confirm === 'reset' ? '确认恢复默认' : '确认应用'}</button></div></section></div>}
  </>;
}
