import { useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth';
import { ActionGate } from './action-gate';

/** A retired account, changed image or closed view cannot export a late result. */
export function useContentAction(identity: string) {
  const { api } = useAuth();
  const scope = useMemo(() => new ActionGate(api, identity), [api, identity]);
  const [state, setState] = useState({ scope, busy: false, notice: '', error: '' });
  const current = state.scope === scope ? state : { busy: false, notice: '', error: '' };
  useEffect(() => {
    scope.reset();
    const stop = () => scope.reset();
    const unsubscribe = api && !api.isClosed ? api.onClose(stop) : undefined;
    return () => { stop(); unsubscribe?.(); };
  }, [api, scope]);
  async function run(action: (assertActive: () => void) => Promise<void>, success: string) {
    const started = scope.token();
    if (!scope.begin(started)) return;
    const assertActive = () => {
      if (!scope.active(started)) throw Error('内容已切换，已取消操作。');
      api?.assertOpen();
    };
    setState({ scope, busy: true, notice: '', error: '' });
    try {
      assertActive(); await action(assertActive); assertActive(); setState({ scope, busy: false, notice: success, error: '' });
    } catch (e) {
      if (scope.active(started)) setState({ scope, busy: false, notice: '', error: e instanceof Error ? e.message : '操作没有完成，请重试。' });
    } finally {
      scope.finish(started);
    }
  }
  return { api, ...current, run };
}
