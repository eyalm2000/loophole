import { useEffect, useState } from 'react';
import type { Verification } from '../../shared/contracts';
import { api } from '../lib/api';

export function useVerification(domain: string, enabled: boolean) {
  const [result, setResult] = useState<Verification | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setResult(null);
    setError('');
    if (!enabled) return;
    const abort = new AbortController();
    let pending = false;
    const check = async () => {
      if (pending) return;
      pending = true;
      try {
        const value = await api<Verification>('verify-domain', 'POST', { domain }, abort.signal);
        if (!abort.signal.aborted) {
          setResult(value);
          setError('');
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          setResult(null);
          setError((error as Error).message);
        }
      } finally {
        pending = false;
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 1000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [domain, enabled]);
  return { result, error };
}
