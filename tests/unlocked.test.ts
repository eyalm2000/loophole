import { it, expect } from 'vitest';
import { AuthService, type AuthStorage } from '../worker/auth/service';
import { AuthObject } from '../worker/auth/object';

function fixture() {
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
  const env = {
    CONFIG: {
      get: async (key: string, type?: 'json') => {
        const value = kv.get(key);
        return value === undefined ? null : type === 'json' ? JSON.parse(value) : value;
      },
      put: async (key: string, value: string) => {
        kv.set(key, value);
      },
    },
  };
  const service = new AuthService(storage, env);
  return { service, records, kv, storage, env };
}
it('opens onboarding without secrets, preserves settings when the PIN is set, then locks management', async () => {
  const { service, kv } = fixture();
  expect(await service.initialized()).toBe(false);
  const config = await service.config('');
  await expect(
    service.save('', { ...config, onboardingComplete: true }, 'gateway.example.com'),
  ).rejects.toMatchObject({ status: 400 });
  const saved = await service.save(
    '',
    { ...config, domain: 'dns.example.com', onboardingStep: 5 },
    'gateway.example.com',
  );
  const session = await service.setup('2468', 'owner');
  expect(await service.initialized()).toBe(true);
  expect((await service.config(session.token)).domain).toBe('dns.example.com');
  expect(JSON.parse(kv.get('settings')!).domain).toBe(saved.domain);
  await expect(service.config('')).rejects.toMatchObject({ status: 401 });
  await expect(service.save('', saved, 'gateway.example.com')).rejects.toMatchObject({
    status: 401,
  });
  await expect(service.setup('9999', 'other')).rejects.toMatchObject({ status: 409 });
  expect((await service.login('2468', 'owner')).token).toBeTruthy();
});
it('serializes simultaneous first-PIN submissions so only one wins', async () => {
  const { storage, env } = fixture();
  const object = new AuthObject(
    {
      storage: {
        ...storage,
        list: (options: { prefix: string }) => storage.list(options.prefix),
        getAlarm: async () => null,
        setAlarm: async () => {},
      },
    } as any,
    env as any,
  );
  const submit = (pin: string) =>
    object.fetch(
      new Request('https://auth.internal/', {
        method: 'POST',
        body: JSON.stringify({ action: 'setup', pin, client: 'owner' }),
      }),
    );
  const results = await Promise.all([submit('2468'), submit('9999')]);
  expect(results.map((response) => response.status)).toEqual([200, 409]);
});
