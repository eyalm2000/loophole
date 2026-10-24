import { initialConfig, type Config } from '../../shared/contracts';
import { validateConfig } from '../../shared/validation';
import { endpointFor } from '../dns/providers';
import { HttpError } from '../errors';
import { digest, pinVerifier, randomToken, sameSecret } from './crypto';

export interface AuthStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(prefix: string): Promise<Map<string, T>>;
}
export class AuthService {
  constructor(
    private storage: AuthStorage,
    private env: {
      CONFIG: { put(key: string, value: string): Promise<unknown> };
    },
  ) {}
  async initialized(): Promise<boolean> {
    return Boolean(await this.storage.get('owner'));
  }
  private async draft(): Promise<Config> {
    const existing = await this.storage.get<Config>('draft');
    if (existing) return existing;
    const config = {
      ...initialConfig,
      revision: crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
    };
    await this.env.CONFIG.put('settings', JSON.stringify(config));
    await this.storage.put('draft', config);
    return config;
  }
  private pin(value: string) {
    if (!/^\d{4}$/.test(value)) throw new HttpError(400, 'Use a four-digit PIN.');
  }
  async limit(client: string, scope = 'login', maximum = 5): Promise<void> {
    const now = Date.now();
    for (const [key, max] of [
      [`limit:${scope}:all`, maximum * 10],
      [`limit:${scope}:${client}`, maximum],
    ] as const) {
      const previous = await this.storage.get<{ count: number; reset: number; strikes: number }>(
        key,
      );
      const record =
        previous && previous.reset > now
          ? previous
          : { count: 0, reset: now + 60000, strikes: previous?.strikes || 0 };
      if (record.count >= max)
        throw new HttpError(429, 'Too many attempts. Please wait before trying again.', {
          'retry-after': String(Math.ceil((record.reset - now) / 1000)),
        });
      record.count++;
      if (record.count === max) {
        record.strikes = Math.min(record.strikes + 1, 6);
        record.reset = now + Math.min(3600000, 60000 * 2 ** (record.strikes - 1));
      }
      await this.storage.put(key, record);
    }
  }
  async setup(pin: string, client: string): Promise<{ token: string; expiresAt: number }> {
    await this.limit(client, 'setup');
    if (await this.initialized())
      throw new HttpError(409, 'This gateway already has an owner. Sign in instead.');
    this.pin(pin);
    const salt = randomToken(),
      pepper = randomToken();
    const verifier = await pinVerifier(pin, salt, pepper);
    const draft = await this.draft();
    const wait = 1100 - (Date.now() - Date.parse(draft.updatedAt));
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const config = {
      ...draft,
      onboardingStep: draft.onboardingStep === 5 ? 6 : draft.onboardingStep,
      revision: crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
    };
    await this.env.CONFIG.put('settings', JSON.stringify(config));
    await this.storage.put('owner', { salt, pepper, verifier, generation: randomToken(), config });
    await this.storage.delete('draft');
    return this.createSession();
  }
  private async owner(): Promise<Owner> {
    const owner = await this.storage.get<Owner>('owner');
    if (!owner) throw new HttpError(401, 'Set up the gateway first.');
    return owner;
  }
  private async createSession(): Promise<{ token: string; expiresAt: number }> {
    const token = randomToken(),
      expiresAt = Date.now() + 8 * 60 * 60 * 1000;
    const owner = await this.owner();
    await this.storage.put('session:' + (await digest(token)), {
      expiresAt,
      generation: owner.generation,
    });
    return { token, expiresAt };
  }
  async login(pin: string, client: string): Promise<{ token: string; expiresAt: number }> {
    await this.limit(client);
    this.pin(pin);
    const owner = await this.owner();
    if (!(await sameSecret(await pinVerifier(pin, owner.salt, owner.pepper), owner.verifier)))
      throw new HttpError(401, 'That PIN is incorrect.');
    return this.createSession();
  }
  async session(token: string): Promise<{ expiresAt: number }> {
    if (!(await this.initialized())) return { expiresAt: 0 };
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(401, 'Sign in to continue.');
    const record = await this.storage.get<{ expiresAt: number; generation: string }>(
      'session:' + (await digest(token)),
    );
    if (
      !record ||
      record.expiresAt <= Date.now() ||
      record.generation !== (await this.owner()).generation
    )
      throw new HttpError(401, 'Your session has expired. Sign in again.');
    return { expiresAt: record.expiresAt };
  }
  async logout(token: string): Promise<void> {
    await this.storage.delete('session:' + (await digest(token)));
  }
  async config(token: string): Promise<Config> {
    await this.session(token);
    return validateConfig((await this.storage.get<Owner>('owner'))?.config ?? (await this.draft()));
  }
  async save(token: string, value: unknown, gateway: string): Promise<Config> {
    await this.session(token);
    let config: Config;
    try {
      config = validateConfig(value);
      endpointFor(config, gateway);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : 'Invalid settings.');
    }
    const owner = await this.storage.get<Owner>('owner');
    if (!owner && config.onboardingComplete)
      throw new HttpError(400, 'Set a PIN before finishing setup.');
    const current = owner?.config ?? (await this.draft());
    if (config.revision !== current.revision)
      throw new HttpError(409, 'Settings changed in another session. Reload before saving.');
    // KV permits one write per second per key, including rapid onboarding steps.
    const wait = 1100 - (Date.now() - Date.parse(current.updatedAt));
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const saved = { ...config, revision: crypto.randomUUID(), updatedAt: new Date().toISOString() };
    await this.env.CONFIG.put('settings', JSON.stringify(saved));
    if (owner) await this.storage.put('owner', { ...owner, config: saved });
    else await this.storage.put('draft', saved);
    return saved;
  }
  async changePin(token: string, current: string, next: string, client: string): Promise<void> {
    await this.session(token);
    await this.limit(client);
    this.pin(next);
    const owner = await this.owner();
    if (!(await sameSecret(await pinVerifier(current, owner.salt, owner.pepper), owner.verifier)))
      throw new HttpError(401, 'The current PIN is incorrect.');
    const salt = randomToken(),
      pepper = randomToken();
    await this.storage.put('owner', {
      ...owner,
      salt,
      pepper,
      verifier: await pinVerifier(next, salt, pepper),
      generation: randomToken(),
    });
  }
  async cleanup(): Promise<void> {
    const now = Date.now();
    for (const [key, value] of await this.storage.list<{ expiresAt: number }>('session:'))
      if (value.expiresAt <= now) await this.storage.delete(key);
    for (const [key, value] of await this.storage.list<{ reset: number }>('limit:'))
      if (value.reset + 86400000 <= now) await this.storage.delete(key);
  }
}
interface Owner {
  salt: string;
  pepper: string;
  verifier: string;
  generation: string;
  config: Config;
}
