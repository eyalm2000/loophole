import { describe, it, expect, vi, afterEach } from 'vitest';
import { endpointFor, validateEndpoint } from '../worker/dns/providers';
import { handleDns } from '../worker/dns/proxy';
import { validateConfig } from '../shared/validation';
import { initialConfig } from '../shared/contracts';

const query = Uint8Array.from([
  0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 7, 101, 120, 97, 109, 112, 108, 101, 3, 99, 111, 109, 0, 0, 1,
  0, 1,
]);
const answer = query.slice();
answer[2] = 0x81;
answer[3] = 0x80;
const config = initialConfig;
afterEach(() => vi.unstubAllGlobals());
describe('provider endpoints', () => {
  it('uses the complete AdGuard endpoint without appending dns-query twice', () => {
    expect(endpointFor(config).href).toBe('https://dns.adguard-dns.com/dns-query');
  });
  it('encodes the NextDNS device name and requires a profile', () => {
    expect(
      endpointFor({ ...config, provider: 'nextdns', nextdnsId: 'abcdef', deviceName: 'My phone' })
        .href,
    ).toBe('https://dns.nextdns.io/abcdef/My%20phone');
    expect(() => endpointFor({ ...config, provider: 'nextdns' })).toThrow();
  });
  it.each(['.', '..'])(
    'never loses the NextDNS profile for a dot-segment device name %s',
    (deviceName) => {
      expect(() =>
        endpointFor({ ...config, provider: 'nextdns', nextdnsId: 'abcdef', deviceName }),
      ).toThrow();
      expect(() => validateConfig({ ...config, deviceName })).toThrow();
    },
  );
  it.each([
    'http://example.com/dns-query',
    'https://user:password@example.com',
    'https://127.0.0.1/dns-query',
    'https://[::1]/dns-query',
    'https://10.0.0.1/dns-query',
    'https://example.com/#fragment',
    'https://dns.local/dns-query',
  ])('rejects unsafe custom endpoint %s', (value) => {
    expect(() => validateEndpoint(value, 'gateway.example.com')).toThrow();
  });
  it('rejects self loops and invalid provider names', () => {
    expect(() =>
      validateEndpoint('https://gateway.example.com/dns-query', 'gateway.example.com'),
    ).toThrow();
    expect(() => validateConfig({ ...config, provider: 'unknown' })).toThrow();
  });
});
describe('DNS proxy', () => {
  it('preserves upstream parameters, strips cookies and returns a valid wire response', async () => {
    let forwarded: Request | undefined;
    vi.stubGlobal('fetch', async (request: Request) => {
      forwarded = request;
      return new Response(answer, { headers: { 'content-type': 'application/dns-message' } });
    });
    const response = await handleDns(
      new Request(
        'https://gateway.example.com/dns-query?dns=' +
          Buffer.from(query).toString('base64url') +
          '&secret=unwanted',
        { headers: { cookie: 'admin=secret', authorization: 'Bearer secret' } },
      ),
      {
        ...config,
        provider: 'custom',
        customDohUrl: 'https://resolver.example.com/dns-query?token=keep',
      },
    );
    expect(response.status).toBe(200);
    expect(new URL(forwarded!.url).searchParams.get('token')).toBe('keep');
    expect(new URL(forwarded!.url).searchParams.has('secret')).toBe(false);
    expect(forwarded!.headers.has('cookie')).toBe(false);
    expect(forwarded!.headers.has('authorization')).toBe(false);
    expect(forwarded!.redirect).toBe('manual'); // Workers rejects redirect: error at Request construction.
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(answer);
  });
  it('accepts POST binary DNS and rejects upstream HTML without relabeling it', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response('<html>failure</html>', { headers: { 'content-type': 'text/html' } }),
    );
    await expect(
      handleDns(
        new Request('https://gateway.example.com/dns-query', {
          method: 'POST',
          headers: { 'content-type': 'application/dns-message' },
          body: query,
        }),
        config,
      ),
    ).rejects.toMatchObject({ status: 502 });
  });
  it('explains an upstream HTTP-version rejection instead of silently changing provider', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 505 }));
    await expect(
      handleDns(
        new Request(
          'https://gateway.example.com/dns-query?dns=' + Buffer.from(query).toString('base64url'),
        ),
        config,
      ),
    ).rejects.toMatchObject({ status: 502, message: expect.stringContaining('HTTP/2') });
  });
  it('rejects malformed input and unsupported methods before forwarding', async () => {
    await expect(
      handleDns(new Request('https://gateway.example.com/dns-query?dns=bad!'), config),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      handleDns(new Request('https://gateway.example.com/dns-query', { method: 'DELETE' }), config),
    ).rejects.toMatchObject({ status: 405 });
    await expect(
      handleDns(
        new Request('https://gateway.example.com/dns-query', { method: 'POST', body: query }),
        config,
      ),
    ).rejects.toMatchObject({ status: 415 });
  });
  it('rejects mismatched DNS questions and oversized requests', async () => {
    const wrong = answer.slice();
    wrong[13] = 120;
    vi.stubGlobal(
      'fetch',
      async () => new Response(wrong, { headers: { 'content-type': 'application/dns-message' } }),
    );
    await expect(
      handleDns(
        new Request(
          'https://gateway.example.com/dns-query?dns=' + Buffer.from(query).toString('base64url'),
        ),
        config,
      ),
    ).rejects.toMatchObject({ status: 502 });
    await expect(
      handleDns(
        new Request('https://gateway.example.com/dns-query', {
          method: 'POST',
          headers: { 'content-type': 'application/dns-message' },
          body: new Uint8Array(65536),
        }),
        config,
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
  it('rejects truncated query records before contacting an upstream', async () => {
    const malformed = query.slice();
    malformed[11] = 1; // One additional record claimed, none present.
    vi.stubGlobal(
      'fetch',
      async () => new Response(answer, { headers: { 'content-type': 'application/dns-message' } }),
    );
    await expect(
      handleDns(
        new Request(
          'https://gateway.example.com/dns-query?dns=' +
            Buffer.from(malformed).toString('base64url'),
        ),
        config,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('rejects a custom upstream that loops through the configured gateway domain', () => {
    expect(() =>
      endpointFor(
        {
          ...config,
          provider: 'custom',
          domain: 'custom.example.com',
          customDohUrl: 'https://custom.example.com/dns-query',
        },
        'deployment.workers.dev',
      ),
    ).toThrow();
  });
});
