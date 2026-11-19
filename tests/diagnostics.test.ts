import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  checkEffectiveDoh,
  checkKv,
  clientFamily,
  diagnosticQuery,
  inspectReply,
  probeDohPath,
  probeUpstream,
  randomId,
  runDiagnostics,
} from '../worker/dns/diagnostics';
import { makeQuery } from '../worker/dns/wire';
import { activeConfig, refreshConfig } from '../worker/config';
import { initialConfig, type Config } from '../shared/contracts';
const MIME = 'application/dns-message';
const saved: Config = {
  ...initialConfig,
  provider: 'nextdns',
  nextdnsId: 'abcdef',
  deviceName: 'My phone',
  domain: 'dns.example.com',
  revision: 'rev-1',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
function reply(query: Uint8Array, rcode = 0): Uint8Array<ArrayBuffer> {
  const out = Uint8Array.from(query);
  out[2] = 0x81;
  out[3] = 0x80 | rcode;
  return out;
}
const dns = (body: Uint8Array) => new Response(body, { headers: { 'content-type': MIME } });
async function bodyOf(request: Request) {
  return new Uint8Array(await request.arrayBuffer());
}
function echo(transform: (query: Uint8Array) => Uint8Array = (query) => reply(query)) {
  const seen: Request[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    seen.push(request);
    return dns(transform(await bodyOf(request.clone())));
  });
  return seen;
}
const kv = (value: unknown) => ({ get: async () => value }) as any;
afterEach(() => vi.unstubAllGlobals());
describe('diagnostic DNS transaction IDs', () => {
  it('uses a non-zero random ID for diagnostics and keeps the shared query builder unchanged', () => {
    const ids = new Set(Array.from({ length: 64 }, () => randomId()));
    expect(ids.has(0)).toBe(false);
    expect(ids.size).toBeGreaterThan(1);
    const query = diagnosticQuery(0xbeef);
    expect([query[0], query[1]]).toEqual([0xbe, 0xef]);
    expect(Array.from(query.slice(2))).toEqual(Array.from(makeQuery('example.com').slice(2)));
    expect([makeQuery('example.com')[0], makeQuery('example.com')[1]]).toEqual([0, 0]);
  });
  it('accepts only a matching, well-formed NOERROR answer', () => {
    const query = diagnosticQuery(0x1234);
    expect(inspectReply(reply(query), 0x1234)).toBeNull();
    expect(inspectReply(reply(query), 0x1235)?.code).toBe('id-mismatch');
    const other = reply(query);
    other[13] = 120; // example.com -> xxample.com
    expect(inspectReply(other, 0x1234)?.code).toBe('question-mismatch');
    expect(inspectReply(reply(query).slice(0, 20), 0x1234)?.code).toBe('malformed-dns');
    expect(inspectReply(Uint8Array.from([0x12, 0x34, 0x81]), 0x1234)?.code).toBe('malformed-dns');
    expect(inspectReply(query, 0x1234)?.code).toBe('malformed-dns'); // A query, not a response.
    const servfail = inspectReply(reply(query, 2), 0x1234);
    expect(servfail).toMatchObject({ status: 'FAIL', code: 'dns-rcode' });
    expect(servfail?.summary).toContain('SERVFAIL');
  });
});
describe('saved upstream resolver check', () => {
  it('queries the saved provider endpoint with a matching random ID', async () => {
    const seen = echo();
    const result = await probeUpstream(saved, 'gateway.example.com');
    expect(result).toMatchObject({ status: 'PASS' });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://dns.nextdns.io/abcdef/My%20phone');
    expect(seen[0].method).toBe('POST');
    expect(seen[0].redirect).toBe('manual');
    const sent = await bodyOf(seen[0]);
    expect(sent[0] * 256 + sent[1]).not.toBe(0);
  });
  it.each([
    [new Response('busy', { status: 500 }), 'http-status'],
    [new Response(null, { status: 505 }), 'http-version'],
    [new Response(null, { status: 302, headers: { location: 'https://x.example/' } }), 'redirect'],
    [new Response('<html></html>', { headers: { 'content-type': 'text/html' } }), 'content-type'],
    [dns(Uint8Array.from([1, 2, 3])), 'malformed-dns'],
  ])('classifies HTTP-level and malformed responses separately (%#)', async (response, code) => {
    vi.stubGlobal('fetch', async () => response);
    expect(await probeUpstream(saved, 'gateway.example.com')).toMatchObject({
      status: 'FAIL',
      code,
    });
  });
  it('detects a wrong transaction ID, a different question and a DNS error code', async () => {
    echo((query) => {
      const out = reply(query);
      out[1] ^= 1;
      return out;
    });
    expect((await probeUpstream(saved, 'g.example.com')).code).toBe('id-mismatch');
    echo((query) => {
      const out = reply(query);
      out[13] = 120;
      return out;
    });
    expect((await probeUpstream(saved, 'g.example.com')).code).toBe('question-mismatch');
    echo((query) => reply(query, 3));
    const nx = await probeUpstream(saved, 'g.example.com');
    expect(nx).toMatchObject({ status: 'FAIL', code: 'dns-rcode' });
    expect(nx.summary).toContain('NXDOMAIN');
  });
  it('reports connection failures and timeouts distinctly, never as PASS', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('connection reset');
    });
    expect(await probeUpstream(saved, 'g.example.com')).toMatchObject({
      status: 'FAIL',
      code: 'transport',
    });
    vi.stubGlobal(
      'fetch',
      (request: Request) =>
        new Promise((_, reject) =>
          request.signal.addEventListener('abort', () => reject(request.signal.reason)),
        ),
    );
    expect(await probeUpstream(saved, 'g.example.com', 30)).toMatchObject({
      status: 'FAIL',
      code: 'timeout',
    });
    vi.stubGlobal('fetch', () => new Promise(() => undefined)); // Ignores the abort signal.
    expect(await probeUpstream(saved, 'g.example.com', 30)).toMatchObject({
      status: 'FAIL',
      code: 'timeout',
    });
  });
  it('fails unusable saved settings without contacting any resolver', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await probeUpstream({ ...saved, nextdnsId: '' }, 'g.example.com')).toMatchObject({
      status: 'FAIL',
      code: 'config',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
describe('end-to-end DoH path', () => {
  it('runs through the /dns-query handler and validates the answer', async () => {
    const seen = echo();
    expect(await probeDohPath(saved, 'https://dns.example.com/api/diagnostics')).toMatchObject({
      status: 'PASS',
    });
    expect(seen[0].url).toBe('https://dns.nextdns.io/abcdef/My%20phone');
  });
  it('fails when the handler rejects the upstream answer', async () => {
    echo((query) => {
      const out = reply(query);
      out[0] ^= 1;
      return out;
    });
    expect(await probeDohPath(saved, 'https://dns.example.com/')).toMatchObject({
      status: 'FAIL',
      code: 'proxy-error',
    });
  });
  it('reports a DNS error code returned through the handler', async () => {
    echo((query) => reply(query, 2));
    expect(await probeDohPath(saved, 'https://dns.example.com/')).toMatchObject({
      status: 'FAIL',
      code: 'dns-rcode',
    });
  });
});
describe('Workers KV settings check', () => {
  it('passes only when KV holds the current valid settings', async () => {
    expect((await checkKv(kv(saved), saved)).status).toBe('PASS');
    expect(await checkKv(kv(null), saved)).toMatchObject({ status: 'FAIL', code: 'kv-missing' });
    expect(await checkKv(kv({ provider: 'x' }), saved)).toMatchObject({
      status: 'FAIL',
      code: 'kv-invalid',
    });
    expect(await checkKv(kv({ ...saved, revision: 'old' }), saved)).toMatchObject({
      status: 'INCONCLUSIVE',
      code: 'kv-stale',
    });
    expect(
      await checkKv(
        {
          get: async () => {
            throw new Error('down');
          },
        } as any,
        saved,
      ),
    ).toMatchObject({ status: 'FAIL', code: 'kv-read' });
    expect(
      await checkKv({ get: () => new Promise(() => undefined) } as any, saved, 20),
    ).toMatchObject({ status: 'INCONCLUSIVE', code: 'timeout' });
  });
});
describe('configuration consistency between the dashboard and /dns-query', () => {
  const url = 'https://dns.example.com/api/diagnostics';
  const newer = { ...saved, revision: 'rev-2', updatedAt: '2026-01-02T00:00:00.000Z' };
  const older = { ...saved, revision: 'rev-0', updatedAt: '2025-12-31T00:00:00.000Z' };
  // A KV stub whose answer can change, read through the real isolate cache used by /dns-query.
  function store(value: unknown) {
    const state = { value };
    const namespace = { get: async () => state.value } as unknown as KVNamespace;
    return { namespace, state, effective: () => activeConfig(namespace) };
  }
  it('passes only when /dns-query uses the saved revision', async () => {
    echo();
    const { effective } = store(saved);
    expect(await checkEffectiveDoh(effective, saved, url)).toMatchObject({ status: 'PASS' });
  });
  it('is inconclusive when the isolate cache still holds older settings', async () => {
    echo();
    const { namespace, effective } = store(saved);
    refreshConfig(namespace, older); // Cached by an earlier /dns-query in this isolate.
    const doh = await checkEffectiveDoh(effective, saved, url);
    expect(doh).toMatchObject({ status: 'INCONCLUSIVE', code: 'config-mismatch' });
    // A direct KV read alone would have reported PASS here.
    expect((await checkKv(namespace, saved)).status).toBe('PASS');
  });
  it('is inconclusive when KV is ahead of or behind the saved settings', async () => {
    echo();
    for (const value of [newer, older]) {
      const { namespace, effective } = store(value);
      expect(await checkEffectiveDoh(effective, saved, url)).toMatchObject({
        status: 'INCONCLUSIVE',
        code: 'config-mismatch',
      });
      const kvCheck = await checkKv(namespace, saved);
      expect(kvCheck).toMatchObject({ status: 'INCONCLUSIVE', code: 'kv-stale' });
      expect(kvCheck.summary).toContain('different settings revision');
      expect(kvCheck.summary).toContain(value === newer ? 'later' : 'earlier');
    }
  });
  it('keeps a real handler failure as FAIL even when revisions differ', async () => {
    echo((query) => reply(query, 2));
    const { effective } = store(newer);
    const doh = await checkEffectiveDoh(effective, saved, url);
    expect(doh).toMatchObject({ status: 'FAIL', code: 'dns-rcode' });
    expect(doh.summary).toContain('different settings revision');
  });
  it('fails without querying when /dns-query has no valid settings', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    for (const value of [null, { provider: 'broken' }]) {
      const { effective } = store(value);
      expect(await checkEffectiveDoh(effective, saved, url)).toMatchObject({
        status: 'FAIL',
        code: 'no-settings',
      });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('is inconclusive, never PASS, when loading the effective settings hangs', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(
      await checkEffectiveDoh(() => new Promise(() => undefined), saved, url, 20),
    ).toMatchObject({ status: 'INCONCLUSIVE', code: 'timeout' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('reports the mismatch in the full report', async () => {
    echo();
    const report = await runDiagnostics({
      config: saved,
      requestUrl: url,
      headers: new Headers(),
      kv: kv(newer),
      effectiveConfig: async () => newer,
      applicationMs: 1,
    });
    const byId = Object.fromEntries(report.checks.map((check) => [check.id, check.status]));
    expect(byId).toMatchObject({
      'kv-config': 'INCONCLUSIVE',
      'doh-path': 'INCONCLUSIVE',
      upstream: 'PASS',
    });
  });
});
describe('observed client IP family', () => {
  const headers = (value: Record<string, string>) => new Headers(value);
  it('derives the family only from valid Cloudflare metadata', () => {
    expect(clientFamily(headers({ 'cf-connecting-ip': '203.0.113.10' }))).toBe('ipv4');
    expect(clientFamily(headers({ 'cf-connecting-ip': '2001:db8::1' }))).toBe('ipv6');
    expect(
      clientFamily(
        headers({ 'cf-connecting-ip': '240.1.2.3', 'cf-connecting-ipv6': '2001:db8::5' }),
      ),
    ).toBe('ipv6');
  });
  it.each([
    {},
    { 'cf-connecting-ip': '' },
    { 'cf-connecting-ip': 'unknown' },
    { 'cf-connecting-ip': '999.1.1.1' },
    { 'cf-connecting-ip': '1.2.3.4, 5.6.7.8' },
    { 'cf-connecting-ip': '01.2.3.4' },
    { 'cf-connecting-ip': '::ffff:192.0.2.1' },
    { 'cf-connecting-ip': '2001:db8::1%eth0' },
    { 'cf-connecting-ip': '203.0.113.1', 'cf-connecting-ipv6': 'garbage' },
  ])('does not guess from missing or invalid metadata %j', (value) => {
    expect(clientFamily(new Headers(value))).toBeNull();
  });
});
describe('diagnostic report', () => {
  const run = (headers: Record<string, string>, timeoutMs?: number) =>
    runDiagnostics({
      config: saved,
      requestUrl: 'https://dns.example.com/api/diagnostics',
      headers: new Headers(headers),
      kv: kv(saved),
      effectiveConfig: async () => saved,
      applicationMs: 4,
      timeoutMs,
    });
  it('reports every server-side check independently', async () => {
    echo();
    const report = await run({ 'cf-connecting-ip': '2001:db8::7' });
    expect(Object.fromEntries(report.checks.map((check) => [check.id, check.status]))).toEqual({
      application: 'PASS',
      'kv-config': 'PASS',
      'doh-path': 'PASS',
      upstream: 'PASS',
      'client-ip-family': 'PASS',
      'ip-enforcement': 'UNSUPPORTED',
    });
    expect(report.observedClientFamily).toBe('ipv6');
    for (const check of report.checks.filter((check) => check.id.endsWith('path')))
      expect(check.durationMs).toBeGreaterThanOrEqual(0);
  });
  it('marks IP-family enforcement as untested and missing metadata as inconclusive', async () => {
    echo();
    const report = await run({});
    const byId = Object.fromEntries(report.checks.map((check) => [check.id, check]));
    expect(byId['ip-enforcement']).toMatchObject({ status: 'UNSUPPORTED', code: 'not-tested' });
    expect(byId['ip-enforcement'].summary).toContain('Not tested');
    expect(byId['client-ip-family']).toMatchObject({ status: 'INCONCLUSIVE' });
    expect(report.observedClientFamily).toBeNull();
  });
  it('never reports PASS for network checks that timed out', async () => {
    vi.stubGlobal('fetch', () => new Promise(() => undefined));
    const report = await run({ 'cf-connecting-ip': '203.0.113.1' }, 30);
    const byId = Object.fromEntries(report.checks.map((check) => [check.id, check]));
    expect(byId['doh-path']).toMatchObject({ status: 'FAIL', code: 'timeout' });
    expect(byId.upstream).toMatchObject({ status: 'FAIL', code: 'timeout' });
  });
  it('does not expose the upstream URL, profile, device, client address or DNS bytes', async () => {
    const queries: string[] = [];
    vi.stubGlobal('fetch', async (request: Request) => {
      const body = await bodyOf(request.clone());
      queries.push(Buffer.from(body).toString('base64'), Buffer.from(body).toString('base64url'));
      return dns(reply(body, 2));
    });
    for (const headers of [{ 'cf-connecting-ip': '203.0.113.99' }, {}]) {
      const text = JSON.stringify(await run(headers));
      for (const secret of [
        'abcdef',
        'dns.nextdns.io',
        'My phone',
        'My%20phone',
        '203.0.113.99',
        ...queries,
      ])
        expect(text).not.toContain(secret);
    }
  });
});
