import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

export function useResource<T>(path: string, pollMs = 0) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    setData(undefined);
    setError('');
    setLoading(true);
    const load = async () => {
      try {
        const result = await api<T>(path, { signal: controller.signal });
        if (active) { setData(result); setError(''); }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : '无法加载数据');
      } finally {
        if (active) {
          setLoading(false);
          if (pollMs) timer = setTimeout(load, pollMs);
        }
      }
    };
    void load();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [path, pollMs, revision]);
  return { data, error, loading, reload, setData };
}
