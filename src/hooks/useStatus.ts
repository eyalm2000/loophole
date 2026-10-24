import { useEffect, useState } from 'react';
import type { DnsStatus } from '../../shared/contracts';
import { api } from '../lib/api';
export function useStatus() {
  const [status, setStatus] = useState<DnsStatus | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    let pending = false;
    let lastProbe = '';
    let renew = true;
    let generation = 0;
    let expiry: number | undefined;
    const update = async () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      const current = generation;
      const started = performance.now();
      try {
        const value = await api<DnsStatus>(
          renew ? 'status?renew=1' : 'status',
          'GET',
          undefined,
          AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]),
        );
        if (abort.signal.aborted || current !== generation) return;
        renew = false;
        const remaining = Math.max(0, value.validForMs - (performance.now() - started));
        clearTimeout(expiry);
        setStatus({ ...value, connected: value.connected && remaining > 0 });
        if (value.connected && remaining > 0)
          expiry = window.setTimeout(() => setStatus(null), remaining);
        setError('');
        if (value.probe && value.probe !== lastProbe) {
          lastProbe = value.probe;
          // Native browser DNS, never a direct DoH request. An NXDOMAIN response
          // still lets the gateway recognize this unpredictable question.
          const image = new Image();
          image.referrerPolicy = 'no-referrer';
          image.src = `https://${value.probe}/dns-status`;
        }
      } catch (error) {
        if (!abort.signal.aborted && current === generation) {
          clearTimeout(expiry);
          setStatus(null);
          setError((error as Error).message);
        }
      } finally {
        pending = false;
      }
    };
    update();
    const timer = window.setInterval(update, 1000);
    const visible = () => {
      generation++;
      renew = true;
      clearTimeout(expiry);
      setStatus(null);
      setError('');
      void update();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      abort.abort();
      clearInterval(timer);
      clearTimeout(expiry);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  return { connected: status?.connected, error };
}
