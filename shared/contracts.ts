export const providers = [
  {
    id: 'nextdns',
    name: 'NextDNS',
  },
  {
    id: 'adguard',
    name: 'AdGuard DNS',
  },
  {
    id: 'controld',
    name: 'Control D',
  },
  {
    id: 'custom',
    name: 'Custom resolver',
  },
] as const;
export type Provider = (typeof providers)[number]['id'];
export interface Config {
  provider: Provider;
  nextdnsId: string;
  deviceName: string;
  customDohUrl: string;
  domain: string;
  onboardingComplete: boolean;
  onboardingStep: number;
  androidMethod: 'shizuku' | 'adb' | 'unknown';
  revision: string;
  updatedAt: string;
}
export const initialConfig: Config = {
  provider: 'adguard',
  nextdnsId: '',
  deviceName: '',
  customDohUrl: '',
  domain: '',
  onboardingComplete: false,
  onboardingStep: 0,
  androidMethod: 'unknown',
  revision: '',
  updatedAt: '',
};
export const propagationNotice =
  'Settings saved. Updates can take a few minutes to apply everywhere.';
export interface DnsStatus {
  connected: boolean;
  lastSeen: number | null;
  probe?: string;
  validForMs: number;
}
export interface Verification {
  valid: boolean;
  hostname: string;
  recordName: string;
  records: string[];
  issues: string[];
}
export interface TestResult {
  ok: boolean;
  latencyMs: number;
  provider: Provider;
}
