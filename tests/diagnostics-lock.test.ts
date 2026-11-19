import { it, expect, vi } from 'vitest';
import { AuthObject } from '../worker/auth/object';
import type { AuthStorage } from '../worker/auth/service';
// Replaces only the check runner, so the real router, lock and Durable Object logic run.
vi.mock('../worker/dns/diagnostics', async (original) => ({
  ...(await original<typeof import('../worker/dns/diagnostics')>()),
  runDiagnostics: vi.fn(async () => {
    throw new Error('unexpected failure inside a check');
  }),
}));
const { default: worker } = await import('../worker/index');
it('releases the lock when a diagnostic run throws unexpectedly', async () => {
  const records = new Map<string, unknown>();
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
  const CONFIG = { get: async () => null, put: async () => undefined };
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
    AUTH: {
      idFromName: () => 'owner',
      get: () => ({
        fetch: (url: string, init: RequestInit) => object.fetch(new Request(url, init)),
      }),
    },
  } as any;
  const setup = await object.fetch(
    new Request('https://auth.internal/', {
      method: 'POST',
      body: JSON.stringify({ action: 'setup', pin: '2468', client: 'c' }),
    }),
  );
  const { token } = (await setup.json()) as { token: string };
  const run = () =>
    worker.fetch(
      new Request('https://dns.example.com/api/diagnostics', {
        method: 'POST',
        headers: {
          origin: 'https://dns.example.com',
          'content-type': 'application/json',
          cookie: `__Host-dns_session=${token}`,
        },
        body: '{}',
      }),
      env,
      { waitUntil() {} } as any,
    );
  const failed = await run();
  expect(failed.status).toBe(503);
  expect(JSON.stringify(await failed.json())).not.toContain('unexpected failure');
  expect(records.has('diagnostic:lease')).toBe(false);
  // The next run is not blocked by a leftover lease.
  expect((await run()).status).toBe(503);
  expect(records.has('diagnostic:lease')).toBe(false);
}, 10000);
