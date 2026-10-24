import type { Verification } from '../../../shared/contracts';
import { CopyCard, ErrorText, Spinner } from '../ui';
export function SvcbStep({
  domain,
  result,
  error,
}: {
  domain: string;
  result: Verification | null;
  error: string;
}) {
  return (
    <div className="stack">
      <p>
        Open your domain’s DNS records (wherever your domain’s DNS is hosted) and add this record.
      </p>
      <dl className="record-fields">
        <div>
          <dt>Type</dt>
          <dd>SVCB</dd>
        </div>
        <div>
          <dt>Priority</dt>
          <dd>1</dd>
        </div>
        <div>
          <dt>TTL</dt>
          <dd>Auto</dd>
        </div>
      </dl>
      <CopyCard label="Name" value={`_dns.${domain}`} />
      <CopyCard label="Target" value={`${domain}.`} />
      <CopyCard label="Parameters" value={'alpn="h3" dohpath="/dns-query{?dns}"'} />
      <ErrorText>{error}</ErrorText>
      <p className="loading-status muted">
        <Spinner />
        Waiting for your DNS record
      </p>
      {result && (
        <p role="status">{result.valid ? 'DNS record found.' : result.issues.join(' ')}</p>
      )}
      <p className="muted">
        Checking every second. Setup continues when the record is detected. DNS updates can take a
        few minutes.
      </p>
    </div>
  );
}
