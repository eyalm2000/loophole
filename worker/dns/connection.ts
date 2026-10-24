import type { AuthStorage } from '../auth/service';
import type { DnsStatus } from '../../shared/contracts';

interface Connection {
  hostname: string;
  domain: string;
  issuedAt: number;
  lastSeen: number | null;
  expiresAt: number;
  outstanding: { hostname: string; expiresAt: number }[];
}
export class ConnectionProbe {
  constructor(private storage: AuthStorage) {}
  async status(session: string, domain: string, renew = false): Promise<DnsStatus> {
    if (!domain || domain.length > 209 || domain.endsWith('.workers.dev'))
      return { connected: false, lastSeen: null, validForMs: 0 };
    const key = 'connection:' + session;
    let record = await this.storage.get<Connection>(key);
    const now = Date.now();
    if (renew || !record || record.domain !== domain || now - record.issuedAt >= 2000) {
      const previous = record?.outstanding ?? [];
      const outstanding =
        !renew && record?.domain === domain
          ? previous.filter((probe) => probe.expiresAt > now)
          : [];
      for (const probe of previous)
        if (!outstanding.includes(probe)) await this.storage.delete('probe:' + probe.hostname);
      const challenge = {
        hostname: `${crypto.randomUUID().replaceAll('-', '')}.dns-check.${domain}`,
        expiresAt: now + 10000,
      };
      record = {
        domain,
        hostname: challenge.hostname,
        issuedAt: now,
        lastSeen: !renew && record?.domain === domain ? record.lastSeen : null,
        expiresAt: now + 8 * 3600000,
        outstanding: [...outstanding, challenge],
      };
      await this.storage.put('probe:' + record.hostname, { key, expiresAt: challenge.expiresAt });
      await this.storage.put(key, record);
    }
    const age = record.lastSeen === null ? Infinity : now - record.lastSeen;
    const validForMs = age >= 0 ? Math.max(0, 5000 - age) : 0;
    return {
      connected: validForMs > 0,
      lastSeen: record.lastSeen,
      probe: record.hostname,
      validForMs,
    };
  }
  async observe(hostname: string): Promise<void> {
    if (!/^[a-f0-9]{32}\.dns-check\./.test(hostname)) return;
    const challenge = await this.storage.get<{ key: string; expiresAt: number }>(
      'probe:' + hostname,
    );
    if (!challenge || challenge.expiresAt <= Date.now()) return;
    const record = await this.storage.get<Connection>(challenge.key);
    if (!record?.outstanding.some((probe) => probe.hostname === hostname)) return;
    await this.storage.put(challenge.key, { ...record, lastSeen: Date.now() });
  }
  async cleanup(): Promise<void> {
    for (const prefix of ['probe:', 'connection:'])
      for (const [key, record] of await this.storage.list<{ expiresAt: number }>(prefix))
        if (record.expiresAt <= Date.now()) await this.storage.delete(key);
  }
}
