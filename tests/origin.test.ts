import { describe, it, expect } from 'vitest';
import { checkOrigin } from '../src/lib/diagnostics';
const ok = (async () => Response.json({ initialized: true })) as unknown as typeof fetch;
describe('browser custom-domain origin check', () => {
  it('passes only when the dashboard is open on the saved custom domain', async () => {
    const calls: string[] = [];
    const fetcher = (async (url: string) => {
      calls.push(url);
      return Response.json({ initialized: true });
    }) as unknown as typeof fetch;
    const result = await checkOrigin('dns.example.com', 'dns.example.com', fetcher);
    expect(result).toMatchObject({ id: 'origin', status: 'PASS' });
    expect(result.summary).toContain('does not prove public DNS propagation');
    expect(calls).toEqual(['/api/setup-state']);
  });
  it('is inconclusive on another origin or without a saved domain', async () => {
    expect(await checkOrigin('dns.example.com', 'x.workers.dev', ok)).toMatchObject({
      status: 'INCONCLUSIVE',
      code: 'other-origin',
    });
    expect(await checkOrigin('', 'x.workers.dev', ok)).toMatchObject({
      status: 'INCONCLUSIVE',
      code: 'no-domain',
    });
  });
  it('fails without claiming to know whether DNS, TLS or routing broke', async () => {
    const result = await checkOrigin('dns.example.com', 'dns.example.com', (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch);
    expect(result).toMatchObject({ status: 'FAIL', code: 'network' });
    expect(result.summary).toContain('do not reveal');
  });
  it('fails on HTTP errors, foreign responses and timeouts', async () => {
    expect(
      await checkOrigin(
        'd.example.com',
        'd.example.com',
        (async () => new Response('no', { status: 522 })) as unknown as typeof fetch,
      ),
    ).toMatchObject({ status: 'FAIL', code: 'http-status' });
    expect(
      await checkOrigin(
        'd.example.com',
        'd.example.com',
        (async () => new Response('<html>parked</html>')) as unknown as typeof fetch,
      ),
    ).toMatchObject({ status: 'FAIL', code: 'unexpected-response' });
    const hang = ((_: string, init: RequestInit) =>
      new Promise((_, reject) =>
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason)),
      )) as unknown as typeof fetch;
    expect(await checkOrigin('d.example.com', 'd.example.com', hang, 20)).toMatchObject({
      status: 'FAIL',
      code: 'timeout',
    });
  });
});
