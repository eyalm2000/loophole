import type { Config } from '../../shared/contracts';
import { HttpError } from '../errors';

export function validateEndpoint(value: string, gatewayHost?: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, 'Enter a complete HTTPS DNS endpoint.');
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  // Only public DNS names; literals, local names, nonstandard ports and gateway loops are disallowed.
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== '443') ||
    host.includes(':') ||
    /^[\d.]+$/.test(host) ||
    !host.includes('.') ||
    /\.(local|localhost|internal|test|invalid|arpa)$/.test(host) ||
    host === gatewayHost?.toLowerCase() ||
    !/^[a-z0-9.-]+$/.test(host)
  )
    throw new HttpError(
      400,
      'Use a public HTTPS resolver hostname on port 443, without credentials, fragments, or a gateway loop.',
    );
  return url;
}
export function endpointFor(config: Config, gatewayHost?: string): URL {
  switch (config.provider) {
    case 'nextdns':
      if (!/^[a-f0-9]{6}$/i.test(config.nextdnsId))
        throw new HttpError(400, 'A six-character NextDNS profile ID is required.');
      if (config.deviceName === '.' || config.deviceName === '..')
        throw new HttpError(400, 'Device names cannot be a URL dot segment.');
      return new URL(
        `https://dns.nextdns.io/${config.nextdnsId}${config.deviceName ? '/' + encodeURIComponent(config.deviceName) : ''}`,
      );
    case 'adguard':
      return new URL('https://dns.adguard-dns.com/dns-query');
    case 'controld':
      return new URL('https://freedns.controld.com/p2');
    case 'custom': {
      const url = validateEndpoint(config.customDohUrl, gatewayHost);
      if (url.hostname.replace(/\.$/, '') === config.domain)
        throw new HttpError(400, 'The upstream cannot point back to this gateway.');
      return url;
    }
    default:
      throw new HttpError(400, 'Unknown DNS provider.');
  }
}
