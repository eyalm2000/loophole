import type { DiagnosticCheck } from '../../shared/contracts';
const LABEL = 'Custom domain from this browser';
// Same-origin only: the browser never sends diagnostic requests to another host.
export async function checkOrigin(
  domain: string,
  currentHost: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 8000,
): Promise<DiagnosticCheck> {
  const started = performance.now();
  const base = { id: 'origin', label: LABEL } as const;
  let response: Response;
  try {
    response = await fetcher('/api/setup-state', {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timeout = ['TimeoutError', 'AbortError'].includes((error as Error)?.name);
    return {
      ...base,
      status: 'FAIL',
      durationMs: Math.round(performance.now() - started),
      code: timeout ? 'timeout' : 'network',
      summary: timeout
        ? 'This browser did not get an answer from the dashboard origin in time.'
        : 'This browser could not reach the dashboard origin. Browsers do not reveal whether DNS, TLS, or routing failed.',
      remedy: 'Reload the page and retry. Check the domain in the Cloudflare dashboard.',
    };
  }
  const durationMs = Math.round(performance.now() - started);
  let valid = false;
  try {
    const body = (await response.json()) as { initialized?: unknown } | null;
    valid = response.ok && typeof body?.initialized === 'boolean';
  } catch {
    valid = false;
  }
  if (!valid)
    return {
      ...base,
      status: 'FAIL',
      durationMs,
      code: response.ok ? 'unexpected-response' : 'http-status',
      summary: response.ok
        ? 'The dashboard origin answered, but not with a Loophole response.'
        : `The dashboard origin answered with HTTP ${response.status}.`,
      remedy: 'Check that the domain routes to this Worker in the Cloudflare dashboard.',
    };
  if (!domain)
    return {
      ...base,
      status: 'INCONCLUSIVE',
      durationMs,
      code: 'no-domain',
      summary: 'No custom domain is saved, so there is nothing to compare this origin with.',
    };
  if (currentHost !== domain)
    return {
      ...base,
      status: 'INCONCLUSIVE',
      durationMs,
      code: 'other-origin',
      summary: `This dashboard is open on ${currentHost}, not on ${domain}, so the custom domain was not tested.`,
      remedy: `Open https://${domain} and run the test there.`,
    };
  return {
    ...base,
    status: 'PASS',
    durationMs,
    summary:
      'This browser reached your custom domain over HTTPS and got a valid Loophole response. This does not prove public DNS propagation or reachability from other networks.',
  };
}
