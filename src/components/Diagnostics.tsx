import { useRef, useState } from 'react';
import type { DiagnosticCheck, DiagnosticReport } from '../../shared/contracts';
import { api } from '../lib/api';
import { checkOrigin } from '../lib/diagnostics';
import { ErrorText, Spinner } from './ui';
export function Diagnostics({ domain }: { domain: string }) {
  const [running, setRunning] = useState(false),
    [checks, setChecks] = useState<DiagnosticCheck[] | null>(null),
    [error, setError] = useState('');
  const active = useRef(false);
  async function run() {
    if (active.current) return;
    active.current = true;
    setRunning(true);
    setError('');
    try {
      const report = await api<DiagnosticReport>(
        'diagnostics',
        'POST',
        {},
        AbortSignal.timeout(30000),
      );
      const origin = await checkOrigin(domain, location.hostname);
      const list = [...report.checks];
      list.splice(2, 0, origin);
      setChecks(list);
    } catch (error) {
      setChecks(null);
      setError(
        (error as Error).name === 'TimeoutError'
          ? 'The connectivity test did not finish in time. Retry.'
          : (error as Error).message,
      );
    } finally {
      active.current = false;
      setRunning(false);
    }
  }
  const failed = checks?.filter((check) => check.status === 'FAIL').length ?? 0;
  const unclear = checks?.filter((check) => check.status === 'INCONCLUSIVE').length ?? 0;
  return (
    <div className="diagnostics">
      <div className="diagnostics-header">
        <span className="field-caption">Connectivity test</span>
        <button
          type="button"
          className="button secondary compact"
          disabled={running}
          onClick={() => void run()}
        >
          {running && <Spinner />}
          {running ? 'Testing…' : 'Test connectivity'}
        </button>
      </div>
      <ErrorText>{error}</ErrorText>
      {checks && (
        <>
          <p className="diagnostics-summary" role="status">
            {failed
              ? `${failed} check${failed === 1 ? '' : 's'} failed.`
              : unclear
                ? 'No check failed, but some results are inconclusive.'
                : 'All executed checks passed.'}
          </p>
          <ul className="diagnostic-list" aria-label="Connectivity test results">
            {checks.map((check) => (
              <li key={check.id} className="diagnostic-item" data-status={check.status}>
                <div className="diagnostic-title">
                  <span className="diagnostic-status">{check.status}</span>
                  <strong>{check.label}</strong>
                  {check.durationMs !== null && (
                    <span className="diagnostic-duration">{check.durationMs} ms</span>
                  )}
                </div>
                <p>{check.summary}</p>
                {check.remedy && check.status !== 'PASS' && (
                  <p className="diagnostic-remedy">{check.remedy}</p>
                )}
              </li>
            ))}
          </ul>
          <p className="diagnostics-note">
            Each DNS check sends one example.com A query. A pass shows only that this query got a
            valid answer. It does not test your NextDNS filtering rules, account settings, or other
            record types.
          </p>
        </>
      )}
    </div>
  );
}
