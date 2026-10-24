import type { Config } from '../../shared/contracts';
import { HttpError, readBytes } from '../errors';
import { endpointFor } from './providers';
import { question, validateRecords } from './wire';

const MIME = 'application/dns-message';
export async function handleDns(
  request: Request,
  config: Config,
  observed?: (hostname: string) => void,
): Promise<Response> {
  if (!['GET', 'POST'].includes(request.method))
    throw new HttpError(405, 'Use GET or POST for DNS queries.', { Allow: 'GET, POST, OPTIONS' });
  const incoming = new URL(request.url);
  let bytes: Uint8Array<ArrayBuffer>;
  if (request.method === 'GET') {
    const dns = incoming.searchParams.get('dns') || '';
    if (dns.length > 87380) throw new HttpError(413, 'DNS message is too large.');
    if (!dns || !/^[A-Za-z0-9_-]+$/.test(dns) || dns.length % 4 === 1)
      throw new HttpError(400, 'Invalid base64url DNS query.');
    try {
      bytes = Uint8Array.from(atob(dns.replace(/-/g, '+').replace(/_/g, '/')), (x) =>
        x.charCodeAt(0),
      );
    } catch {
      throw new HttpError(400, 'Invalid DNS query.');
    }
  } else {
    if (request.headers.get('content-type')?.split(';')[0].trim() !== MIME)
      throw new HttpError(415, 'Expected application/dns-message.');
    bytes = await readBytes(request, 65535);
  }
  const original = question(bytes);
  validateRecords(bytes, original.end);
  const endpoint = endpointFor(config, incoming.hostname);
  // Observing a validated query proves its route, even if the upstream is slow.
  observed?.(original.identity.split('|')[0]);
  // Keep the DoH method and strip all caller metadata.
  if (request.method === 'GET') endpoint.searchParams.set('dns', incoming.searchParams.get('dns')!);
  const upstreamRequest = new Request(endpoint, {
    method: request.method,
    headers: { accept: MIME, ...(request.method === 'POST' ? { 'content-type': MIME } : {}) },
    body: request.method === 'POST' ? bytes : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(8000),
    cache: 'no-store',
  });
  try {
    const response = await fetch(upstreamRequest);
    if (response.status === 505)
      throw new HttpError(
        502,
        'This resolver requires HTTP/2 or HTTP/3 upstream, which this runtime did not negotiate. Choose another resolver.',
      );
    if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim() !== MIME)
      throw new Error('Invalid upstream response');
    const reply = await readBytes(response, 65535);
    const parsed = question(reply, true);
    if (reply[0] !== bytes[0] || reply[1] !== bytes[1] || parsed.identity !== original.identity)
      throw new Error('DNS response mismatch');
    validateRecords(reply, parsed.end);
    return new Response(reply, {
      headers: {
        'content-type': MIME,
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof HttpError && error.status === 502) throw error;
    throw new HttpError(502, 'The selected DNS resolver could not complete the query.');
  }
}
