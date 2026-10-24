import { useCallback, useEffect, useState } from 'react';
import { type Config, propagationNotice } from '../shared/contracts';
import { api } from './lib/api';
import { PinScreen } from './components/PinScreen';
import { Dashboard } from './components/Dashboard';
import { OnboardingWizard } from './components/onboarding/OnboardingWizard';
import { ErrorText, Spinner } from './components/ui';

type Phase = 'loading' | 'login' | 'ready' | 'error';
export default function App() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [config, setConfig] = useState<Config | null>(null);
  const [pinSet, setPinSet] = useState(false);
  const [wizard, setWizard] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const expired = useCallback(() => {
    setConfig(null);
    setPhase('login');
    setError('');
    setNotice('');
  }, []);
  async function signedIn(locked = true) {
    const result = await api<{ config: Config }>('config');
    setConfig(result.config);
    setPinSet(locked);
    setWizard(!result.config.onboardingComplete || !locked);
    setPhase('ready');
    setError('');
  }
  async function load() {
    setPhase('loading');
    setError('');
    try {
      const state = await api<{ initialized: boolean }>('setup-state');
      if (state.initialized) {
        try {
          await api('session');
        } catch {
          setPhase('login');
          return;
        }
      }
      await signedIn(state.initialized);
    } catch (error) {
      setError((error as Error).message);
      setPhase('error');
    }
  }
  useEffect(() => {
    void load();
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, [expired]);
  async function save(next: Config, quiet = false) {
    const result = await api<{ config: Config }>('config', 'PUT', next);
    setConfig(result.config);
    if (!quiet) setNotice(propagationNotice);
  }
  async function logout() {
    try {
      await api('logout', 'POST', {});
      expired();
    } catch (error) {
      setError((error as Error).message);
    }
  }
  return (
    <main className="app-shell">
      <div className="app-frame">
        {phase === 'loading' && (
          <p className="loading-status muted" role="status">
            <Spinner />
            Loading…
          </p>
        )}
        {phase === 'error' && (
          <section className="stack">
            <h1>Unable to connect to Loophole</h1>
            <ErrorText>{error}</ErrorText>
            <button className="button" onClick={load}>
              Try again
            </button>
          </section>
        )}
        {phase === 'login' && <PinScreen onSuccess={signedIn} />}
        {phase === 'ready' &&
          config &&
          (wizard ? (
            <OnboardingWizard
              config={config}
              save={save}
              pinSet={pinSet}
              onPinSet={signedIn}
              finish={() => setWizard(false)}
            />
          ) : (
            <Dashboard config={config} save={save} expired={expired} logout={logout} />
          ))}
        {phase === 'ready' && <ErrorText>{error}</ErrorText>}
        {notice && (
          <div className="save-notice" role="status" aria-label="Settings update">
            <span>{notice}</span>
            <button className="text-button" onClick={() => setNotice('')}>
              Dismiss
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
