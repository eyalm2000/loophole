import { describe, it, expect, vi } from 'vitest';
import { AuthService, type AuthStorage } from '../worker/auth/service';
import { initialConfig } from '../shared/contracts';

function fixture() {
  const records = new Map<string, unknown>();
  const storage: AuthStorage = {
    async get<T>(key: string) {
      return records.get(key) as T | undefined;
    },
    async put(key: string, value: unknown) {
      records.set(key, structuredClone(value));
    },
    async delete(key: string) {
      return records.delete(key);
    },
    async list<T>(prefix: string) {
      return new Map([...records].filter(([key]) => key.startsWith(prefix))) as Map<string, T>;
    },
  };
  const kv = new Map<string, string>();
  const env = {
    CONFIG: {
      put: async (key: string, value: string) => {
        kv.set(key, value);
      },
    },
  };
  const service = new AuthService(storage, env);
  return { service, records, storage, env, kv };
}
describe('owner authentication', () => {
  it('rejects unsupported stored settings instead of converting the provider', async () => {
    const { service, records } = fixture();
    const session = await service.setup('1234', 'owner');
    const owner = records.get('owner') as any;
    owner.config.provider = 'quad9';
    await expect(service.config(session.token)).rejects.toThrow('Choose a supported provider.');
  });
  it('does not create new client records after the aggregate limit is exhausted', async () => {
    const { service, records } = fixture();
    for (let i = 0; i < 50; i++) await service.limit(`client-${i}`);
    const before = records.size;
    await expect(service.limit('new-attacker')).rejects.toMatchObject({ status: 429 });
    expect(records.size).toBe(before);
  });
  it('sets the PIN once and allows only one owner', async () => {
    const { service } = fixture();
    await service.setup('1234', 'client');
    await expect(service.setup('9876', 'client')).rejects.toMatchObject({ status: 409 });
  });
  it('stores a verifier, creates expiring sessions, and revokes logout', async () => {
    const { service, records } = fixture();
    const session = await service.setup('1234', 'client');
    expect(JSON.stringify([...records])).not.toContain('1234');
    expect(JSON.stringify([...records])).not.toContain(session.token);
    expect((await service.session(session.token)).expiresAt).toBeGreaterThan(Date.now());
    await service.logout(session.token);
    await expect(service.session(session.token)).rejects.toMatchObject({ status: 401 });
  });
  it('persists cooldowns across service recreation and stops a sixth attempt', async () => {
    const { service, storage, env } = fixture();
    await service.setup('1234', 'owner');
    for (let i = 0; i < 5; i++)
      await expect(service.login('9999', 'attacker')).rejects.toMatchObject({ status: 401 });
    const recreated = new AuthService(storage, env);
    await expect(recreated.login('1234', 'attacker')).rejects.toMatchObject({ status: 429 });
  });
  it('rejects stale settings revisions, persists changes, and requires sessions', async () => {
    const { service, env, kv } = fixture();
    const session = await service.setup('1234', 'owner');
    await expect(service.save('', initialConfig, 'gateway.example.com')).rejects.toMatchObject({
      status: 401,
    });
    const config = await service.config(session.token);
    const saved = await service.save(
      session.token,
      { ...config, provider: 'adguard' },
      'gateway.example.com',
    );
    expect(JSON.parse(kv.get('settings')!).provider).toBe('adguard');
    expect(saved.revision).not.toBe(config.revision);
    await expect(service.save(session.token, config, 'gateway.example.com')).rejects.toMatchObject({
      status: 409,
    });
  });
  it('changing the PIN revokes all sessions and requires the current PIN', async () => {
    const { service, env } = fixture();
    const first = await service.setup('1234', 'owner');
    const second = await service.login('1234', 'another');
    await expect(service.changePin(first.token, '9999', '4567', 'owner')).rejects.toMatchObject({
      status: 401,
    });
    await service.changePin(first.token, '1234', '4567', 'owner');
    await expect(service.session(second.token)).rejects.toMatchObject({ status: 401 });
    expect((await service.login('4567', 'owner')).token).toBeTruthy();
  });
  it('expires sessions after eight hours and rejects malformed setup PINs', async () => {
    const { service, env } = fixture();
    await expect(service.setup('abcd', 'owner')).rejects.toMatchObject({
      status: 400,
    });
    const session = await service.setup('1234', 'owner');
    const now = vi.spyOn(Date, 'now').mockReturnValue(session.expiresAt + 1);
    try {
      await expect(service.session(session.token)).rejects.toMatchObject({ status: 401 });
    } finally {
      now.mockRestore();
    }
  });
  it('does not commit configuration in the authority when persistence fails', async () => {
    const { service, env } = fixture();
    const session = await service.setup('1234', 'owner');
    const before = await service.config(session.token);
    env.CONFIG.put = async () => {
      throw new Error('offline');
    };
    await expect(
      service.save(session.token, { ...before, provider: 'adguard' }, 'gateway.example.com'),
    ).rejects.toThrow('offline');
    expect((await service.config(session.token)).revision).toBe(before.revision);
  });
});
