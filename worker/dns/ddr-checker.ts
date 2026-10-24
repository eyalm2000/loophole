import type { Verification } from '../../shared/contracts';
import { hostname } from '../../shared/validation';
import { dnsName, makeQuery, question, u16 } from './wire';
import { HttpError, readBytes } from '../errors';

export function parseSvcb(bytes: Uint8Array, host: string): Verification {
  const output: Verification = {
    valid: false,
    hostname: host,
    recordName: '_dns.' + host,
    records: [],
    issues: [],
  };
  const parsed = question(bytes, true);
  if (parsed.identity !== `_dns.${host}|64|1`) throw new Error('Unexpected SVCB question.');
  if ((bytes[3] & 15) !== 0) {
    output.issues.push('The DNS lookup did not return a successful answer.');
    return output;
  }
  let at = parsed.end;
  for (let i = 0; i < u16(bytes, 6); i++) {
    const owner = dnsName(bytes, at);
    at = owner.end;
    const type = u16(bytes, at),
      klass = u16(bytes, at + 2),
      size = u16(bytes, at + 8);
    at += 10;
    const end = at + size;
    if (end > bytes.length) throw new Error('Truncated SVCB record.');
    if (type !== 64 || klass !== 1 || owner.name !== '_dns.' + host) {
      at = end;
      continue;
    }
    const priority = u16(bytes, at);
    const target = dnsName(bytes, at + 2);
    at = target.end;
    if (at > end) throw new Error('Truncated SVCB target.');
    const parameters = new Map<number, Uint8Array>();
    let previous = -1;
    while (at < end) {
      const key = u16(bytes, at),
        length = u16(bytes, at + 2);
      at += 4;
      if (at + length > end || key <= previous) throw new Error('Invalid SVCB parameters.');
      parameters.set(key, bytes.slice(at, at + length));
      at += length;
      previous = key;
    }
    const alpn: string[] = [];
    const protocol = parameters.get(1) || new Uint8Array();
    for (let p = 0; p < protocol.length;) {
      const length = protocol[p++];
      if (!length || p + length > protocol.length) throw new Error('Malformed ALPN.');
      alpn.push(new TextDecoder().decode(protocol.slice(p, p + length)));
      p += length;
    }
    const path = new TextDecoder().decode(parameters.get(7));
    const portBytes = parameters.get(3);
    const port = portBytes ? (portBytes.length === 2 ? u16(portBytes, 0) : -1) : 443;
    const mandatory = parameters.get(0);
    let supported = true;
    if (mandatory) {
      if (mandatory.length % 2) supported = false;
      for (let p = 0; p + 1 < mandatory.length; p += 2) {
        const key = u16(mandatory, p);
        if (![1, 2, 3, 4, 6, 7].includes(key) || !parameters.has(key)) supported = false;
      }
    }
    output.records.push(
      `${priority} ${target.name || '.'}. alpn="${alpn.join(',')}" port=${port} dohpath="${path}"`,
    );
    if (
      priority > 0 &&
      (target.name === host || target.name === '') &&
      alpn.includes('h3') &&
      port === 443 &&
      path === '/dns-query{?dns}' &&
      supported
    )
      output.valid = true;
  }
  if (!output.valid)
    output.issues.push(
      output.records.length
        ? 'A record exists, but it must advertise this gateway on h3, port 443, with /dns-query{?dns}.'
        : 'No matching SVCB service record is visible yet. Add the record, then retry after DNS propagation.',
    );
  return output;
}
export async function verifyDomain(value: string): Promise<Verification> {
  let host: string;
  try {
    host = hostname(value);
  } catch {
    throw new HttpError(400, 'Enter a valid gateway hostname.');
  }
  if (host.endsWith('.workers.dev'))
    throw new HttpError(400, 'Use your custom domain for Android DDR setup.');
  try {
    const response = await fetch('https://cloudflare-dns.com/dns-query', {
      method: 'POST',
      headers: { accept: 'application/dns-message', 'content-type': 'application/dns-message' },
      body: makeQuery('_dns.' + host, 64),
      signal: AbortSignal.timeout(8000),
      redirect: 'manual',
      cache: 'no-store',
    });
    if (
      !response.ok ||
      !response.headers.get('content-type')?.startsWith('application/dns-message')
    )
      throw new Error();
    return parseSvcb(await readBytes(response, 65535), host);
  } catch {
    throw new HttpError(502, 'The DNS lookup could not be completed. Please retry.');
  }
}
