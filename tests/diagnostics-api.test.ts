import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../worker/index';
import { AuthObject } from '../worker/auth/object';
import type { AuthStorage } from '../worker/auth/service';
import type { DiagnosticReport } from '../shared/contracts';
const MIME = 'application/dns-message';
const ORIGIN = 'https://dns.example.com';
function gateway() {
  const records = new Map<string, unknown>(),
    kv = new Map<string, string>();
  const storage: AuthStorage = {
    async get<T>(key: string) {
      return records.get(key) as T | undefined;
    },
    async put(key, value) {
      records.set(key, structuredClone(value));
    },
    async delete(key) {
      return records.delete(key);
    },
    async list<T>(prefix: string) {
      return new Map([...records].filter(([key]) => key.startsWith(prefix))) as Map<string, T>;
    },
  };
  const CONFIG = {
    get: async (key: string, type?: 'json') => {
      const value = kv.get(key);
      return value === undefined ? null : type === 'json' ? JSON.parse(value) : value;
    },
    put: async (key: string, value: string) => {
      kv.set(key, value);
    },
  };
  const object = new AuthObject(
    {
      storage: {
        ...storage,
        list: (options: { prefix: string }) => storage.list(options.prefix),
        getAlarm: async () => 1,
        setAlarm: async () => {},
      },
    } as any,
    { CONFIG } as any,
  );
  const env = {
    CONFIG,
    ASSETS: { fetch: async () => new Response('SPA') },
    // Like a Durable Object stub: accepts fetch(url, init) and delivers a Request.
    AUTH: {
      idFromName: () => 'owner',
      get: () => ({
        fetch: (url: string, init: RequestInit) => object.fetch(new Request(url, init)),
      }),
    },
  } as any;
  const action = async (body: Record<string, unknown>) =>
    object.fetch(
      new Request('https://auth.internal/', { method: 'POST', body: JSON.stringify(body) }),
    );
  return { env, records, action };
}
const ctx = { waitUntil() {} } as any;
function diagnostics(env: any, token?: string, headers: Record<string, string> = {}, body = '{}') {
  return worker.fetch(
    new Request(`${ORIGIN}/api/diagnostics`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        'content-type': 'application/json',
        'cf-connecting-ip': '203.0.113.5',
        ...(token ? { cookie: `__Host-dns_session=${token}` } : {}),
        ...headers,
      },
      body,
    }),
    env,
    ctx,
  );
}
async function owned() {
  const g = gateway();
  const { token } = (await (
    await g.action({ action: 'setup', pin: '2468', client: 'c' })
  ).json()) as {
    token: string;
  };
  return { ...g, token };
}
function resolver() {
  const urls: string[] = [];
  vi.stubGlobal('fetch', async (request: Request) => {
    urls.push(request.url.split('?')[0]);
    const param = new URL(request.url).searchParams.get('dns');
    const out = param
      ? new Uint8Array(Buffer.from(param, 'base64url'))
      : new Uint8Array(await request.arrayBuffer());
    out[2] = 0x81;
    out[3] = 0x80;
    return new Response(out, { headers: { 'content-type': MIME } });
  });
  return urls;
}
afterEach(() => vi.unstubAllGlobals());
describe('POST /api/diagnostics', () => {
  it('rejects requests before setup, without a session, and from foreign origins', async () => {
    const fresh = gateway();
    expect((await diagnostics(fresh.env)).status).toBe(401);
    const { env } = await owned();
    const fetch = resolver();
    expect((await diagnostics(env)).status).toBe(401);
    expect((await diagnostics(env, 'x'.repeat(43))).status).toBe(401);
    expect((await diagnostics(env, undefined, { origin: 'https://attacker.example' })).status).toBe(
      403,
    );
    expect(fetch).toHaveLength(0);
    expect((await worker.fetch(new Request(`${ORIGIN}/api/diagnostics`), env, ctx)).status).toBe(
      405,
    );
  }, 10000);
  it('uses only the saved settings and ignores any configuration in the request', async () => {
    const { env, token } = await owned();
    const urls = resolver();
    const response = await diagnostics(
      env,
      token,
      {},
      JSON.stringify({
        config: { provider: 'custom', customDohUrl: 'https://attacker.example/dns-query' },
        url: 'https://attacker.example/',
      }),
    );
    expect(response.status).toBe(200);
    const report = (await response.json()) as DiagnosticReport;
    expect(report.provider).toBe('adguard');
    expect(urls.length).toBe(2);
    expect(urls.every((url) => url === 'https://dns.adguard-dns.com/dns-query')).toBe(true);
    const byId = Object.fromEntries(report.checks.map((check) => [check.id, check.status]));
    expect(byId).toMatchObject({
      application: 'PASS',
      'kv-config': 'PASS',
      'doh-path': 'PASS',
      upstream: 'PASS',
      'client-ip-family': 'PASS',
      'ip-enforcement': 'UNSUPPORTED',
    });
    expect(report.observedClientFamily).toBe('ipv4');
    expect(JSON.stringify(report)).not.toContain('203.0.113.5');
  }, 10000);
  it('refuses overlapping runs and releases the lease afterwards', async () => {
    const { env, token, action, records } = await owned();
    resolver();
    const started = await action({ action: 'diagnostics-start', token, client: 'other' });
    expect(started.status).toBe(200);
    const { lease } = (await started.json()) as { lease: string };
    expect(lease).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const busy = await diagnostics(env, token);
    expect(busy.status).toBe(409);
    expect(busy.headers.get('retry-after')).toBeTruthy();
    // Neither a missing nor a foreign lease token releases someone else's run.
    for (const other of [undefined, 'x'.repeat(43)]) {
      const end = await action({ action: 'diagnostics-end', token, lease: other });
      expect(await end.json()).toEqual({ released: false });
    }
    expect((await diagnostics(env, token)).status).toBe(409);
    const end = await action({ action: 'diagnostics-end', lease });
    expect(await end.json()).toEqual({ released: true });
    expect((await diagnostics(env, token)).status).toBe(200);
    expect(records.has('diagnostic:lease')).toBe(false);
  }, 10000);
  it('enforces the shared diagnostic rate limit', async () => {
    const { env, token } = await owned();
    resolver();
    for (let i = 0; i < 12; i++) expect((await diagnostics(env, token)).status).toBe(200);
    const limited = await diagnostics(env, token);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  }, 10000);
  it('still reports a structured failure when the resolver is down', async () => {
    const { env, token } = await owned();
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('down');
    });
    const response = await diagnostics(env, token);
    expect(response.status).toBe(200);
    const report = (await response.json()) as DiagnosticReport;
    const byId = Object.fromEntries(report.checks.map((check) => [check.id, check]));
    expect(byId.upstream).toMatchObject({ status: 'FAIL', code: 'transport' });
    expect(byId['doh-path']).toMatchObject({ status: 'FAIL', code: 'proxy-error' });
  }, 10000);
});
describe('diagnostic lock', () => {
  it('recovers from an expired lease left by a crashed run', async () => {
    const { env, token, records } = await owned();
    resolver();
    records.set('diagnostic:lease', { token: 'stale', expiresAt: Date.now() - 1 });
    expect((await diagnostics(env, token)).status).toBe(200);
    expect(records.has('diagnostic:lease')).toBe(false);
  }, 10000);
  it('does not let a late run release the lease of a newer run', async () => {
    const { token, action, records } = await owned();
    const first = (await (
      await action({ action: 'diagnostics-start', token, client: 'a' })
    ).json()) as { lease: string };
    // The first run outlives its lease, and a second run takes over.
    (records.get('diagnostic:lease') as { expiresAt: number }).expiresAt = Date.now() - 1;
    const second = (await (
      await action({ action: 'diagnostics-start', token, client: 'b' })
    ).json()) as { lease: string };
    expect(second.lease).not.toBe(first.lease);
    expect(await (await action({ action: 'diagnostics-end', lease: first.lease })).json()).toEqual({
      released: false,
    });
    expect((records.get('diagnostic:lease') as { token: string }).token).toBe(second.lease);
    expect(await (await action({ action: 'diagnostics-end', lease: second.lease })).json()).toEqual(
      { released: true },
    );
  }, 10000);
  it('runs only one of two simultaneous requests', async () => {
    const { env, token, records } = await owned();
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    vi.stubGlobal('fetch', async (request: Request) => {
      calls++;
      await held;
      const out = new Uint8Array(await request.arrayBuffer());
      out[2] = 0x81;
      out[3] = 0x80;
      return new Response(out, { headers: { 'content-type': MIME } });
    });
    const first = diagnostics(env, token);
    await vi.waitFor(() => expect(calls).toBe(2));
    const second = await diagnostics(env, token);
    expect(second.status).toBe(409);
    release();
    expect((await first).status).toBe(200);
    expect(calls).toBe(2);
    expect(records.has('diagnostic:lease')).toBe(false);
  }, 10000);
});
describe('public DoH endpoint regressions', () => {
  it('keeps /dns-query open with its CORS policy and preserves non-zero query IDs', async () => {
    const { env } = await owned();
    resolver();
    const preflight = await worker.fetch(
      new Request(`${ORIGIN}/dns-query`, { method: 'OPTIONS' }),
      env,
      ctx,
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
    const query = Uint8Array.from([
      0xab, 0xcd, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 7, 101, 120, 97, 109, 112, 108, 101, 3, 99, 111,
      109, 0, 0, 1, 0, 1,
    ]);
    const response = await worker.fetch(
      new Request(`${ORIGIN}/dns-query?dns=${Buffer.from(query).toString('base64url')}`),
      env,
      ctx,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0xab, 0xcd]);
  }, 10000);
});
