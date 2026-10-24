import type { Env } from './types';
import { api } from './api/router';
import { activeConfig } from './config';
import { HttpError, json } from './errors';
import { handleDns } from './dns/proxy';
export { AuthObject } from './auth/object';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    try {
      if (path.startsWith('/api/')) return await api(request, env);
      if (path === '/dns-query') {
        if (request.method === 'OPTIONS')
          return new Response(null, {
            status: 204,
            headers: {
              'access-control-allow-origin': '*',
              'access-control-allow-methods': 'GET, POST, OPTIONS',
              'access-control-allow-headers': 'content-type, accept',
              'access-control-max-age': '86400',
            },
          });
        const response = await handleDns(request, await activeConfig(env.CONFIG), (hostname) => {
          if (!/^[a-f0-9]{32}\.dns-check\./.test(hostname)) return;
          ctx.waitUntil(
            env.AUTH.get(env.AUTH.idFromName(env.AUTH_INSTANCE || 'owner'))
              .fetch('https://auth.internal/', {
                method: 'POST',
                body: JSON.stringify({ action: 'observe-dns', hostname }),
              })
              .then(() => undefined)
              .catch(() => undefined),
          );
        });
        return response;
      }
      const asset = await env.ASSETS.fetch(request);
      const response = new Response(asset.body, asset);
      response.headers.set('x-content-type-options', 'nosniff');
      response.headers.set('referrer-policy', 'same-origin');
      response.headers.set('x-frame-options', 'DENY');
      response.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
      response.headers.set(
        'content-security-policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: https:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
      return response;
    } catch (error) {
      if (error instanceof HttpError)
        return json({ error: error.message }, error.status, {
          ...error.headers,
          ...(path === '/dns-query' ? { 'access-control-allow-origin': '*' } : {}),
        });
      return json({ error: 'The gateway could not complete this request. Please retry.' }, 503);
    }
  },
};
