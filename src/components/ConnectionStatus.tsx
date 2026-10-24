import { useStatus } from '../hooks/useStatus';
import { Spinner } from './ui';
export function ConnectionStatus() {
  const status = useStatus();
  return (
    <div
      className="connection-banner"
      data-state={
        status.error
          ? 'unavailable'
          : status.connected === undefined
            ? 'checking'
            : status.connected
              ? 'connected'
              : 'disconnected'
      }
      role="status"
      aria-label="DNS connection"
      title="Checks this browser’s DNS route. Websites cannot read Android’s Private DNS switch; browser Secure DNS may use a different resolver."
    >
      <span className="loading-status">
        {status.connected === undefined && !status.error && <Spinner />}
        {status.error
          ? 'DNS status unavailable'
          : status.connected === undefined
            ? 'Checking your DNS…'
            : status.connected
              ? 'Connected through Loophole'
              : 'Not connected through Loophole'}
      </span>
      {status.error && <small>Status unavailable. Retrying.</small>}
    </div>
  );
}
