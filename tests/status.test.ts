import { describe, it, expect } from 'vitest';
import { parseSvcb } from '../worker/dns/ddr-checker';
import { makeQuery } from '../worker/dns/wire';

describe('SVCB parser', () => {
  it('checks the actual SVCB ALPN and path instead of treating any answer as valid', () => {
    const query = makeQuery('_dns.nextdns.example.com', 64);
    query[2] = 0x81;
    query[3] = 0x80;
    query[7] = 1;
    const target = [
      7,
      ...new TextEncoder().encode('nextdns'),
      7,
      ...new TextEncoder().encode('example'),
      3,
      ...new TextEncoder().encode('com'),
      0,
    ];
    const path = [...new TextEncoder().encode('/dns-query{?dns}')];
    const data = [0, 1, ...target, 0, 1, 0, 3, 2, 104, 51, 0, 7, 0, path.length, ...path];
    const answer = Uint8Array.from([
      ...query,
      192,
      12,
      0,
      64,
      0,
      1,
      0,
      0,
      0,
      60,
      0,
      data.length,
      ...data,
    ]);
    expect(parseSvcb(answer, 'nextdns.example.com').valid).toBe(true);
    answer[query.length + 12 + 2 + target.length + 6] = 50; // h3 -> h2
    expect(parseSvcb(answer, 'nextdns.example.com').valid).toBe(false);
  });
  it('does not accept a truncated DNS message', () => {
    expect(() => parseSvcb(Uint8Array.from([0, 1, 2]), 'example.com')).toThrow();
  });
});
