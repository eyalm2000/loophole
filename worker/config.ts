import type { Config } from '../shared/contracts';
import { validateConfig } from '../shared/validation';
import { HttpError } from './errors';
const cache = new WeakMap<object, { config: Config; at: number }>();
export async function activeConfig(kv: KVNamespace): Promise<Config> {
  const previous = cache.get(kv);
  if (previous && Date.now() - previous.at < 15000) return previous.config;
  try {
    const stored = await kv.get('settings', 'json');
    if (!stored) throw new Error();
    const config = validateConfig(stored);
    cache.set(kv, { config, at: Date.now() });
    return config;
  } catch {
    if (previous) return previous.config;
    throw new HttpError(503, 'DNS settings are not available. Complete gateway setup first.');
  }
}
export function refreshConfig(kv: KVNamespace, config: Config): void {
  cache.set(kv, { config, at: Date.now() });
}
