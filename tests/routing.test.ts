import { describe, it, expect, vi } from 'vitest';
import worker from '../worker/index';
const env = {
  ASSETS: { fetch: async () => new Response('SPA') },
  AUTH: {
    idFromName: () => 'owner',
    get: () => ({ fetch: async () => Response.json({ error: 'Sign in' }, { status: 401 }) }),
  },
} as any;
const ctx = { waitUntil() {} } as any;
describe('explicit routes', () => {
  it('never reports connected from cached activity belonging to the same public IP', async () => {
    const get = vi.fn(async (key: string) =>
      key === 'activity-secret' ? 'legacy-activity-secret-with-32-characters' : Date.now(),
    );
    const result = await worker.fetch(
      new Request('https://gateway.example.com/api/status', {
        headers: { 'cf-connecting-ip': '203.0.113.10' },
      }),
      {
        ...env,
        CONFIG: { get },
        AUTH: {
          idFromName: () => 'owner',
          get: () => ({
            fetch: async () =>
              Response.json({ connected: false, lastSeen: null, probe: 'pending', validForMs: 0 }),
          }),
        },
      } as any,
      ctx,
    );
    expect(((await result.json()) as { connected: boolean }).connected).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });
  it('never serves the SPA for an unknown API route', async () => {
    expect(
      (await worker.fetch(new Request('https://gateway.example.com/api/missing'), env, ctx)).status,
    ).toBe(404);
  });
  it('does not route arbitrary browser paths to DNS based on headers or query parameters', async () => {
    const result = await worker.fetch(
      new Request('https://gateway.example.com/help?dns=anything', {
        headers: { accept: 'application/dns-message' },
      }),
      env,
      ctx,
    );
    expect(await result.text()).toBe('SPA');
    expect(result.headers.get('x-frame-options')).toBe('DENY');
    expect(result.headers.get('permissions-policy')).toBe(
      'camera=(), microphone=(), geolocation=()',
    );
    expect(result.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });
  it('rejects cross-origin setup and unauthenticated configuration reads', async () => {
    const result = await worker.fetch(
      new Request('https://gateway.example.com/api/setup', {
        method: 'POST',
        headers: { origin: 'https://attacker.example.com', 'content-type': 'application/json' },
        body: '{}',
      }),
      env,
      ctx,
    );
    expect(result.status).toBe(403);
    expect(
      (await worker.fetch(new Request('https://gateway.example.com/api/config'), env, ctx)).status,
    ).toBe(401);
  });
});
