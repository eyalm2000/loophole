import type { Config, DiagnosticCheck, DiagnosticReport, IpFamily } from '../../shared/contracts';
import { validateConfig } from '../../shared/validation';
import { HttpError, readBytes } from '../errors';
import { endpointFor } from './providers';
import { handleDns } from './proxy';
import { makeQuery, question, validateRecords } from './wire';
const MIME = 'application/dns-message';
// A fixed, IANA-reserved name with a stable public answer. Never taken from the browser.
export const DIAGNOSTIC_NAME = 'example.com';
export const DIAGNOSTIC_TYPE = 1; // A
const IDENTITY = `${DIAGNOSTIC_NAME}|${DIAGNOSTIC_TYPE}|1`;
export const DIAGNOSTIC_TIMEOUT_MS = 8000;
const RCODES = ['NOERROR', 'FORMERR', 'SERVFAIL', 'NXDOMAIN', 'NOTIMP', 'REFUSED'];
type Outcome = Pick<DiagnosticCheck, 'status' | 'summary' | 'remedy' | 'code'>;
export function randomId(): number {
  const value = new Uint16Array(1);
  do crypto.getRandomValues(value);
  while (value[0] === 0);
  return value[0];
}
// Scoped to diagnostics: the shared makeQuery keeps its zero ID for existing callers.
export function diagnosticQuery(id: number): Uint8Array<ArrayBuffer> {
  const bytes = makeQuery(DIAGNOSTIC_NAME, DIAGNOSTIC_TYPE);
  bytes[0] = id >> 8;
  bytes[1] = id & 255;
  return bytes;
}
// Checks a DNS reply against the exact query sent. Returns null when it is a valid NOERROR answer.
export function inspectReply(reply: Uint8Array, id: number): Outcome | null {
  if (reply.length < 12)
    return fail('malformed-dns', 'The response is too short to be a DNS message.');
  if (reply[0] * 256 + reply[1] !== id)
    return fail(
      'id-mismatch',
      'The DNS response carried a different transaction ID than the query, so it cannot be trusted as the answer.',
    );
  let identity: string;
  try {
    const parsed = question(reply, true);
    validateRecords(reply, parsed.end);
    identity = parsed.identity;
  } catch {
    return fail('malformed-dns', 'The response is not a valid DNS answer message.');
  }
  if (identity !== IDENTITY)
    return fail('question-mismatch', 'The DNS response answered a different question.');
  const rcode = reply[3] & 15;
  if (rcode !== 0)
    return fail(
      'dns-rcode',
      `The resolver answered with DNS error ${RCODES[rcode] ?? `code ${rcode}`}.`,
      rcode === 5
        ? 'The resolver refused the query. Check that your resolver profile allows this gateway.'
        : 'Check the resolver settings and its status page, then retry.',
    );
  return null;
}
function fail(code: string, summary: string, remedy?: string): Outcome {
  return { status: 'FAIL', code, summary, ...(remedy ? { remedy } : {}) };
}
type Deadline<T> =
  { kind: 'value'; value: T } | { kind: 'timeout' } | { kind: 'error'; error: unknown };
async function withDeadline<T>(work: Promise<T>, ms: number): Promise<Deadline<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Deadline<T>>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), ms);
  });
  try {
    return await Promise.race([
      work.then(
        (value): Deadline<T> => ({ kind: 'value', value }),
        (error): Deadline<T> => (isTimeout(error) ? { kind: 'timeout' } : { kind: 'error', error }),
      ),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function isTimeout(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}
const timedOut = (what: string): Outcome => ({
  status: 'FAIL',
  code: 'timeout',
  summary: `${what} did not finish within ${DIAGNOSTIC_TIMEOUT_MS / 1000} seconds.`,
  remedy: 'Retry. If it keeps timing out, the resolver may be slow or unreachable from Cloudflare.',
});
// Sends one fixed query straight to the saved upstream and classifies each failure separately.
export async function probeUpstream(
  config: Config,
  gatewayHost: string,
  timeoutMs = DIAGNOSTIC_TIMEOUT_MS,
): Promise<Outcome> {
  let endpoint: URL;
  try {
    endpoint = endpointFor(config, gatewayHost);
  } catch (error) {
    return fail(
      'config',
      error instanceof HttpError ? error.message : 'The saved resolver settings are not usable.',
      'Open "Change" and save a valid resolver.',
    );
  }
  const id = randomId();
  const result = await withDeadline(
    (async (): Promise<Outcome> => {
      let response: Response;
      try {
        response = await fetch(
          new Request(endpoint, {
            method: 'POST',
            headers: { accept: MIME, 'content-type': MIME },
            body: diagnosticQuery(id),
            redirect: 'manual',
            signal: AbortSignal.timeout(timeoutMs),
            cache: 'no-store',
          }),
        );
      } catch (error) {
        if (isTimeout(error)) throw error;
        // The runtime does not say why fetch() rejected, so the cause is not narrowed further.
        return fail(
          'transport',
          'The request to the resolver failed before any HTTP response arrived. Possible causes include connection, TLS, or runtime fetch errors.',
          'Check that the resolver hostname is correct and online, then retry.',
        );
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        if (response.status === 505)
          return fail(
            'http-version',
            'The resolver requires an HTTP version this runtime did not negotiate.',
            'Choose another resolver.',
          );
        if (response.status >= 300 && response.status < 400)
          return fail(
            'redirect',
            `The resolver answered with a redirect (HTTP ${response.status}), which the gateway does not follow.`,
            'Use the final DoH URL of your resolver.',
          );
        return fail(
          'http-status',
          `The resolver answered with HTTP ${response.status}.`,
          response.status === 404
            ? 'Check the resolver path and profile ID.'
            : 'Check the resolver settings and its status page, then retry.',
        );
      }
      if (response.headers.get('content-type')?.split(';')[0].trim() !== MIME) {
        await response.body?.cancel().catch(() => undefined);
        return fail(
          'content-type',
          'The resolver did not answer with application/dns-message.',
          'Check that the URL is a DoH endpoint, not a web page.',
        );
      }
      let reply: Uint8Array;
      try {
        reply = await readBytes(response, 65535);
      } catch (error) {
        if (isTimeout(error)) throw error;
        return fail('malformed-dns', 'The resolver response could not be read as a DNS message.');
      }
      return (
        inspectReply(reply, id) ??
        pass(
          'The saved resolver returned a valid, matching NOERROR answer to one example.com A query. Filtering rules, account settings, and other record types were not tested.',
        )
      );
    })(),
    timeoutMs,
  );
  if (result.kind === 'timeout') return timedOut('The resolver');
  if (result.kind === 'error')
    return fail('unknown', 'The resolver check failed for an unclassified reason.');
  return result.value;
}
function pass(summary: string): Outcome {
  return { status: 'PASS', summary };
}
// Runs a fixed query through the same handler that serves /dns-query, without network ingress.
export async function probeDohPath(
  config: Config,
  requestUrl: string,
  timeoutMs = DIAGNOSTIC_TIMEOUT_MS,
): Promise<Outcome> {
  const id = randomId();
  const result = await withDeadline(
    handleDns(
      new Request(new URL('/dns-query', requestUrl), {
        method: 'POST',
        headers: { 'content-type': MIME },
        body: diagnosticQuery(id),
      }),
      config,
    ).then((response) => readBytes(response, 65535)),
    timeoutMs,
  );
  if (result.kind === 'timeout') return timedOut('The gateway DNS handler');
  if (result.kind === 'error')
    return fail(
      'proxy-error',
      'The gateway DNS handler did not return a DNS answer' +
        (result.error instanceof HttpError ? `: ${result.error.message}` : '.'),
      'See the resolver check below for the specific cause.',
    );
  return (
    inspectReply(result.value, id) ??
    pass(
      'The /dns-query handler, using the same settings as the dashboard, forwarded one example.com A query and returned a valid, matching NOERROR answer.',
    )
  );
}
export async function checkKv(
  kv: Pick<KVNamespace, 'get'>,
  saved: Config,
  timeoutMs = DIAGNOSTIC_TIMEOUT_MS,
): Promise<Outcome> {
  const result = await withDeadline(kv.get('settings', 'json') as Promise<unknown>, timeoutMs);
  if (result.kind === 'timeout')
    return {
      status: 'INCONCLUSIVE',
      code: 'timeout',
      summary: 'Reading settings from Workers KV did not finish in time.',
      remedy: 'Retry in a minute.',
    };
  if (result.kind === 'error')
    return fail('kv-read', 'Workers KV could not be read.', 'Retry in a minute.');
  if (result.value === null)
    return fail(
      'kv-missing',
      'Workers KV has no settings at this location. /dns-query here can only answer from a short-lived cached copy, if one exists.',
      'Save your resolver settings again.',
    );
  let stored: Config;
  try {
    stored = validateConfig(result.value);
  } catch {
    return fail(
      'kv-invalid',
      'The settings in Workers KV are not valid.',
      'Save your resolver settings again.',
    );
  }
  if (stored.revision !== saved.revision)
    return {
      status: 'INCONCLUSIVE',
      code: 'kv-stale',
      summary: `Workers KV at this location holds a different settings revision than the dashboard's saved settings${direction(stored, saved)}.`,
      remedy:
        'KV changes can take up to a minute to reach every location. Retry shortly. If this persists, save your settings again.',
    };
  return pass(
    'A direct Workers KV read at this location returned the same settings revision the dashboard saved. /dns-query reads the same key but may briefly use a cached copy.',
  );
}
// updatedAt is only a hint; revisions are random, so ordering cannot be proven from them.
function direction(stored: Config, saved: Config): string {
  const kvAt = Date.parse(stored.updatedAt),
    savedAt = Date.parse(saved.updatedAt);
  if (!Number.isFinite(kvAt) || !Number.isFinite(savedAt) || kvAt === savedAt) return '';
  return kvAt > savedAt
    ? ' (the KV copy is timestamped later, which can happen if a save was interrupted)'
    : ' (the KV copy is timestamped earlier and may not have received the latest save yet)';
}
// The end-to-end check runs with the settings /dns-query would use right now (Workers KV through
// the isolate cache), and only passes when they match the dashboard's saved revision.
export async function checkEffectiveDoh(
  loadEffective: () => Promise<Config>,
  saved: Config,
  requestUrl: string,
  timeoutMs = DIAGNOSTIC_TIMEOUT_MS,
): Promise<Outcome> {
  const started = Date.now();
  const loaded = await withDeadline(loadEffective(), timeoutMs);
  if (loaded.kind === 'timeout')
    return {
      status: 'INCONCLUSIVE',
      code: 'timeout',
      summary: 'Loading the settings /dns-query uses did not finish in time, so no query was sent.',
      remedy: 'Retry in a minute.',
    };
  if (loaded.kind === 'error')
    return fail(
      'no-settings',
      '/dns-query has no valid settings at this location, so it cannot answer DNS queries here.',
      'Save your resolver settings again, then retry in a minute.',
    );
  const effective = loaded.value;
  const remaining = Math.max(1, timeoutMs - (Date.now() - started));
  const outcome = await probeDohPath(effective, requestUrl, remaining);
  if (effective.revision === saved.revision) return outcome;
  const note =
    ' /dns-query used a different settings revision than the one saved in the dashboard, so this result may not reflect your current settings.';
  if (outcome.status === 'PASS')
    return {
      status: 'INCONCLUSIVE',
      code: 'config-mismatch',
      summary:
        'The /dns-query handler returned a valid answer, but it used a different settings revision than the one saved in the dashboard.',
      remedy:
        'Settings can take up to a minute to reach every location. Retry shortly. If this persists, save your settings again.',
    };
  return { ...outcome, summary: outcome.summary + note };
}
const IPV4 = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
function isIpv6(value: string): boolean {
  if (value.length > 45 || !value.includes(':') || !/^[0-9a-f:.]+$/i.test(value)) return false;
  try {
    new URL(`http://[${value}]/`);
    return true;
  } catch {
    return false;
  }
}
// Cloudflare sets these headers at its edge. With Pseudo IPv4 enabled, cf-connecting-ip holds a
// substitute IPv4 address and the real IPv6 address is in cf-connecting-ipv6.
export function clientFamily(headers: Headers): IpFamily | null {
  const v6 = headers.get('cf-connecting-ipv6');
  if (v6 !== null) return isIpv6(v6.trim()) ? 'ipv6' : null;
  const ip = headers.get('cf-connecting-ip')?.trim();
  if (!ip) return null;
  if (IPV4.test(ip)) return 'ipv4';
  // An IPv4-mapped IPv6 address does not say which family the connection used.
  if (isIpv6(ip) && !/^::ffff:/i.test(ip)) return 'ipv6';
  return null;
}
export async function runDiagnostics(input: {
  config: Config;
  requestUrl: string;
  headers: Headers;
  kv: Pick<KVNamespace, 'get'>;
  // Must return the configuration /dns-query uses (activeConfig in production).
  effectiveConfig: () => Promise<Config>;
  applicationMs: number;
  timeoutMs?: number;
}): Promise<DiagnosticReport> {
  const started = Date.now();
  const timeoutMs = input.timeoutMs ?? DIAGNOSTIC_TIMEOUT_MS;
  const timed = async (work: Promise<Outcome>) => {
    const at = Date.now();
    const outcome = await work;
    return { ...outcome, durationMs: Date.now() - at };
  };
  const [kv, doh, upstream] = await Promise.all([
    timed(checkKv(input.kv, input.config, timeoutMs)),
    timed(checkEffectiveDoh(input.effectiveConfig, input.config, input.requestUrl, timeoutMs)),
    timed(probeUpstream(input.config, new URL(input.requestUrl).hostname, timeoutMs)),
  ]);
  const family = clientFamily(input.headers);
  const checks: DiagnosticCheck[] = [
    {
      id: 'application',
      label: 'Worker and Durable Object',
      status: 'PASS',
      durationMs: input.applicationMs,
      summary:
        'This Loophole Worker handled the request, and its Durable Object validated your session and returned your saved settings.',
    },
    { id: 'kv-config', label: 'Settings in Workers KV', ...kv },
    { id: 'doh-path', label: 'End-to-end DoH query', ...doh },
    { id: 'upstream', label: 'Saved upstream resolver', ...upstream },
    family
      ? {
          id: 'client-ip-family',
          label: 'Observed client-to-Cloudflare IP family',
          status: 'PASS',
          durationMs: null,
          code: family,
          summary: `Cloudflare reports that this browser reached Cloudflare over ${family === 'ipv4' ? 'IPv4' : 'IPv6'}. This describes only this browser's connection to Cloudflare. It does not show the family your phone uses, or the family Cloudflare uses to reach the resolver.`,
        }
      : {
          id: 'client-ip-family',
          label: 'Observed client-to-Cloudflare IP family',
          status: 'INCONCLUSIVE',
          durationMs: null,
          code: 'no-metadata',
          summary:
            'Cloudflare did not provide a usable client address for this request, so the IP family is unknown.',
        },
    {
      id: 'ip-enforcement',
      label: 'IPv4-only / IPv6-only enforcement',
      status: 'UNSUPPORTED',
      durationMs: null,
      code: 'not-tested',
      summary:
        'Not tested. Cloudflare Workers fetch() has no documented option to explicitly select the IP family of outbound connections, so Loophole cannot force or verify IPv4 or IPv6 toward the resolver. HTTP/2 and HTTP/3 choose the HTTP version, not the IP family.',
    },
  ];
  return {
    durationMs: Date.now() - started + input.applicationMs,
    provider: input.config.provider,
    observedClientFamily: family,
    checks,
  };
}
