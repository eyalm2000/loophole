import type { Env } from '../types';
import type { Config, DnsStatus } from '../../shared/contracts';
import { propagationNotice } from '../../shared/contracts';
import { validateConfig } from '../../shared/validation';
import { digest } from '../auth/crypto';
import { HttpError, json, readJson, requireOrigin } from '../errors';
import { refreshConfig } from '../config';
import { verifyDomain } from '../dns/ddr-checker';
import { handleDns } from '../dns/proxy';
import { makeQuery } from '../dns/wire';

const routes: Record<string, string[]> = {
  '/api/setup-state': ['GET'],
  '/api/setup': ['POST'],
  '/api/login': ['POST'],
  '/api/session': ['GET'],
  '/api/logout': ['POST'],
  '/api/pin': ['POST'],
  '/api/config': ['GET', 'PUT'],
  '/api/verify-domain': ['POST'],
  '/api/test': ['POST'],
  '/api/status': ['GET'],
};
export async function api(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname,
    methods = routes[path];
  if (!methods) throw new HttpError(404, 'API route not found.');
  if (!methods.includes(request.method))
    throw new HttpError(405, 'Method not allowed.', { Allow: methods.join(', ') });
  if (request.method !== 'GET') requireOrigin(request);
  const token =
    request.headers
      .get('cookie')
      ?.match(/(?:^|;\s*)__Host-dns_session=([A-Za-z0-9_-]{43})(?:;|$)/)?.[1] || '';
  const stub = env.AUTH.get(env.AUTH.idFromName(env.AUTH_INSTANCE || 'owner'));
  const ip = request.headers.get('cf-connecting-ip') || '';
  async function call<T = Record<string, unknown>>(
    action: string,
    input: Record<string, unknown> = {},
  ): Promise<T> {
    const result = await stub.fetch('https://auth.internal/', {
      method: 'POST',
      body: JSON.stringify({ action, token, ...input }),
    });
    const value = (await result.json()) as T & { error?: string };
    if (!result.ok)
      throw new HttpError(
        result.status,
        value.error || 'Operation failed.',
        result.headers.has('retry-after')
          ? { 'retry-after': result.headers.get('retry-after')! }
          : {},
      );
    return value;
  }
  const input = request.method === 'GET' ? {} : await readJson(request);
  const string = (key: string, max = 256) => {
    const field = input[key];
    if (typeof field !== 'string' || field.length > max)
      throw new HttpError(400, `Invalid ${key}.`);
    return field;
  };
  const client = async () => digest(ip || 'unknown');
  const cookie = (value: string, age: number) =>
    `__Host-dns_session=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
  switch (path) {
    case '/api/setup-state':
      return json(await call('state'));
    case '/api/setup':
    case '/api/login': {
      const session = await call<{ token: string; expiresAt: number }>(
        path.endsWith('/setup') ? 'setup' : 'login',
        {
          pin: string('pin', 4),
          client: await client(),
        },
      );
      return json({ expiresAt: session.expiresAt }, 200, {
        'set-cookie': cookie(session.token, 28800),
      });
    }
    case '/api/session':
      return json(await call('session'));
    case '/api/logout':
      await call('session');
      await call('logout');
      return json({ ok: true }, 200, { 'set-cookie': cookie('', 0) });
    case '/api/pin':
      await call('pin', {
        pin: string('currentPin', 4),
        next: string('newPin', 4),
        client: await client(),
      });
      return json({ ok: true }, 200, { 'set-cookie': cookie('', 0) });
    case '/api/config': {
      if (request.method === 'GET') return json({ config: await call<Config>('config') });
      const saved = await call<Config>('save', {
        config: input,
        host: new URL(request.url).hostname,
      });
      refreshConfig(env.CONFIG, saved);
      return json({ config: saved, message: propagationNotice });
    }
    case '/api/status': {
      return json(
        await call<DnsStatus>('status', {
          client: await client(),
          renew: new URL(request.url).searchParams.get('renew') === '1',
        }),
      );
    }
    case '/api/verify-domain': {
      await call('verify-domain', { client: await client() });
      return json(await verifyDomain(string('domain', 253)));
    }
    case '/api/test': {
      await call('diagnostic', { client: await client() });
      let config: Config;
      try {
        config = input.config ? validateConfig(input.config) : await call<Config>('config');
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, error instanceof Error ? error.message : 'Invalid settings.');
      }
      const start = Date.now();
      const response = await handleDns(
        new Request(new URL('/dns-query', request.url), {
          method: 'POST',
          headers: { 'content-type': 'application/dns-message' },
          body: makeQuery('example.com'),
        }),
        config,
      );
      const bytes = new Uint8Array(await response.arrayBuffer());
      return json({
        ok: (bytes[3] & 15) === 0,
        latencyMs: Date.now() - start,
        provider: config.provider,
      });
    }
    default:
      throw new HttpError(404, 'API route not found.');
  }
}
