import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Settings from '../src/Settings';
import Overview from '../src/Overview';
import App from '../src/App';
import { setCsrfToken } from '../src/api';

const initial = { values: { prefix: '?', botName: 'zar', color: '000000' }, defaults: { prefix: '?', botName: 'zar', color: '000000' }, version: 0 };
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }
beforeEach(() => { window.history.replaceState(null, '', '/'); setCsrfToken('test-csrf'); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('owner console', () => {
  it('shows only the private login when unauthenticated', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'Unauthorized' }, 401)));
    render(<App />);
    expect(await screen.findByRole('link', { name: /使用 Discord 登录/ })).toHaveAttribute('href', '/auth/discord');
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByText(/登录已过期/)).not.toBeInTheDocument();
    expect(screen.getByText(/服务器管理员权限不授予后台访问权/)).toBeInTheDocument();
  });

  it('confirms global impact and persists using the version and CSRF token', async () => {
    const requests = vi.fn().mockResolvedValueOnce(json(initial)).mockResolvedValueOnce(json({ ...initial, values: { ...initial.values, prefix: '!' }, version: 1 }));
    vi.stubGlobal('fetch', requests);
    render(<Settings onDirty={vi.fn()} />);
    const prefix = await screen.findByLabelText('命令前缀');
    fireEvent.change(prefix, { target: { value: '!' } });
    await userEvent.click(screen.getByRole('button', { name: '保存修改' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('应用到所有服务器');
    expect(requests).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: '确认应用' }));
    await screen.findByText(/配置已持久保存/);
    const options = requests.mock.calls[1][1];
    expect(options.method).toBe('PATCH');
    expect(options.headers['X-CSRF-Token']).toBe('test-csrf');
    expect(JSON.parse(options.body)).toEqual({ version: 0, values: { prefix: '!', botName: 'zar', color: '000000' } });
    expect(screen.getByRole('button', { name: '保存修改' })).toBeDisabled();
  });

  it('retains edits and requires reload after a version conflict', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(initial)).mockResolvedValueOnce(json({ error: 'Version conflict' }, 409)));
    render(<Settings onDirty={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('命令前缀'), { target: { value: '!' } });
    await userEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await userEvent.click(screen.getByRole('button', { name: '确认应用' }));
    await screen.findByText(/配置已被另一个页面修改/);
    expect(screen.getByLabelText('命令前缀')).toHaveValue('!');
    expect(screen.getByRole('button', { name: '保存修改' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '重新加载配置' })).toBeInTheDocument();
  });

  it('never presents a partial cluster snapshot as a healthy bot', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({
      bot: null, sampledAt: '2026-01-01T00:00:00.000Z', complete: false,
      expectedClusters: 2, respondingClusters: 1,
      totals: { guilds: 3, members: 20, membersComplete: false, rssBytes: 2048 },
      manager: { uptimeSeconds: 30, rssBytes: 1024 },
      clusters: [{ id: 0, available: true, ready: true, uptimeSeconds: 20, rssBytes: 1024, shards: [{ id: 0, status: 'ready', pingMs: 10 }] }, { id: 1, available: false, ready: false, uptimeSeconds: null, rssBytes: null, shards: [] }],
    })));
    render(<Overview navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/当前为部分数据/)).toBeInTheDocument());
    expect(screen.getByText('无响应')).toBeInTheDocument();
    expect(screen.queryByText('运行正常')).not.toBeInTheDocument();
    expect(screen.getByText('成员数合计（部分）')).toBeInTheDocument();
  });
});
