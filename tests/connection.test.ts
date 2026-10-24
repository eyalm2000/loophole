import { expect, it, vi } from 'vitest';
import { ConnectionProbe } from '../worker/dns/connection';
import type { AuthStorage } from '../worker/auth/service';

it('correlates an observed DNS lookup to its own browser session without relying on IP addresses', async () => {
  const records = new Map<string, unknown>();
  const storage: AuthStorage = {
    get: async <T>(key: string) => records.get(key) as T | undefined,
    put: async (key, value) => {
      records.set(key, structuredClone(value));
    },
    delete: async (key) => records.delete(key),
    list: async <T>(prefix: string) =>
      new Map([...records].filter(([key]) => key.startsWith(prefix))) as Map<string, T>,
  };
  const probe = new ConnectionProbe(storage);
  const first = await probe.status('session-one', 'dns.example.com');
  expect(first.connected).toBe(false);
  expect(first.probe).toMatch(/^[a-f0-9]{32}\.dns-check\.dns\.example\.com$/);
  await probe.observe('wrong.' + first.probe);
  expect((await probe.status('session-one', 'dns.example.com')).connected).toBe(false);
  await probe.observe(first.probe!);
  expect((await probe.status('session-one', 'dns.example.com')).connected).toBe(true);
  expect((await probe.status('session-two', 'dns.example.com')).connected).toBe(false);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6000);
  const delayed = Date.now();
  try {
    const expired = await probe.status('session-one', 'dns.example.com');
    expect(expired.connected).toBe(false);
    expect(expired.probe).not.toBe(first.probe);
    expect(expired.validForMs).toBe(0);
    // A slow status response may deliver the previous nonce several seconds later.
    await probe.observe(first.probe!);
    expect((await probe.status('session-one', 'dns.example.com')).connected).toBe(true);
    await probe.observe(expired.probe!);
    expect((await probe.status('session-one', 'dns.example.com')).connected).toBe(true);
    expect((await probe.status('session-one', 'dns.example.com', true)).connected).toBe(false);
    await probe.observe(first.probe!);
    expect((await probe.status('session-one', 'dns.example.com')).connected).toBe(false);
    for (let i = 1; i <= 10; i++) {
      clock.mockReturnValue(delayed + i * 2000);
      await probe.status('session-one', 'dns.example.com');
      const outstanding = [...records].filter(
        ([key, value]) =>
          key.startsWith('probe:') && (value as { key: string }).key === 'connection:session-one',
      );
      expect(outstanding.length).toBeLessThanOrEqual(5);
    }
    await probe.observe(first.probe!);
    expect((await probe.status('session-one', 'dns.example.com')).connected).toBe(false);
  } finally {
    clock.mockRestore();
  }
});
