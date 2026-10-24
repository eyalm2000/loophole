import { useState } from 'react';
import { providers, type Config, type TestResult } from '../../shared/contracts';
import { api } from '../lib/api';
import { ProviderForm } from './ProviderForm';
import { ConnectionStatus } from './ConnectionStatus';
import { CopyCard, ErrorText, Spinner } from './ui';
import { Modal } from './Modal';
export function Dashboard({
  config,
  save,
  expired,
  logout,
}: {
  config: Config;
  save: (config: Config) => Promise<void>;
  expired: () => void;
  logout: () => void;
}) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(config),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [pinPanel, setPinPanel] = useState(false),
    [oldPin, setOldPin] = useState(''),
    [newPin, setNewPin] = useState('');
  async function persist() {
    setBusy(true);
    setError('');
    try {
      const result = await api<TestResult>('test', 'POST', { config: draft });
      if (!result.ok)
        throw new Error('The resolver could not complete a DNS query. Check its settings.');
      await save(draft);
      setEditing(false);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function changePin() {
    setBusy(true);
    setError('');
    try {
      await api('pin', 'POST', { currentPin: oldPin, newPin });
      expired();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="dashboard">
      <div className="resolver-row">
        <div>
          <span className="field-caption">Resolver</span>
          <strong>{providers.find((p) => p.id === config.provider)!.name}</strong>
        </div>
        <button
          className="button secondary compact"
          aria-label="Change resolver"
          onClick={() => {
            setDraft(config);
            setEditing(true);
            setError('');
          }}
        >
          Change
        </button>
      </div>
      {config.provider === 'nextdns' && (
        <div className="settings-row">
          <span>Profile</span>
          <span>
            {config.nextdnsId}
            {config.deviceName ? ` · ${config.deviceName}` : ''}
          </span>
        </div>
      )}
      <ConnectionStatus />
      <div className="endpoint-section">
        {config.domain && <CopyCard value={config.domain} label="Private DNS hostname" />}
        <CopyCard value={`${location.origin}/dns-query`} label="DoH URL" />
      </div>
      <div className="dashboard-actions">
        <button
          className="button secondary"
          onClick={() => {
            setPinPanel(true);
            setError('');
          }}
        >
          Change PIN
        </button>
        <button className="button secondary" onClick={logout}>
          Sign out
        </button>
      </div>
      <Modal
        open={editing}
        title="Choose your resolver"
        close={() => setEditing(false)}
        busy={busy}
      >
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void persist();
          }}
        >
          <ProviderForm value={draft} onChange={setDraft} disabled={busy} />
          <ErrorText>{error}</ErrorText>
          <div className="dialog-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
            <button className="button" disabled={busy}>
              {busy && <Spinner />}
              {busy ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </form>
      </Modal>
      <Modal open={pinPanel} title="Change PIN" close={() => setPinPanel(false)} busy={busy}>
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            void changePin();
          }}
        >
          <label>
            Current PIN
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              required
              autoComplete="current-password"
              value={oldPin}
              onChange={(event) => setOldPin(event.target.value)}
            />
          </label>
          <label>
            New PIN
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              required
              autoComplete="new-password"
              value={newPin}
              onChange={(event) => setNewPin(event.target.value)}
            />
          </label>
          <ErrorText>{error}</ErrorText>
          <div className="dialog-actions">
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={() => setPinPanel(false)}
            >
              Cancel
            </button>
            <button className="button" disabled={busy}>
              {busy && <Spinner />}
              {busy ? 'Saving…' : 'Save & sign out'}
            </button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
