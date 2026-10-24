import { describe, it, expect } from 'vitest';
import { activeConfig } from '../worker/config';
import { initialConfig } from '../shared/contracts';

describe('configuration safety', () => {
  it('rejects removed provider presets instead of converting saved settings', async () => {
    await expect(
      activeConfig({ get: async () => ({ ...initialConfig, provider: 'quad9' }) } as any),
    ).rejects.toMatchObject({ status: 503 });
  });
  it('fails closed before setup and refuses malformed saved provider settings', async () => {
    await expect(activeConfig({ get: async () => null } as any)).rejects.toMatchObject({
      status: 503,
    });
    await expect(
      activeConfig({ get: async () => ({ ...initialConfig, provider: 'unrecognized' }) } as any),
    ).rejects.toMatchObject({ status: 503 });
  });
  it('can serve previously validated configuration during storage errors', async () => {
    const kv = { get: async () => ({ ...initialConfig, revision: 'test' }) };
    expect((await activeConfig(kv as any)).provider).toBe('adguard');
    kv.get = async () => {
      throw new Error('offline');
    };
    expect((await activeConfig(kv as any)).provider).toBe('adguard');
  });
});
