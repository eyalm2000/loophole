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
// PASS: executed and its stated conditions were verified. FAIL: executed and a known
// condition failed. UNSUPPORTED: this deployment cannot perform it. INCONCLUSIVE: not
// enough evidence either way. Skipped or timed-out work is never PASS.
export type DiagnosticStatus = 'PASS' | 'FAIL' | 'UNSUPPORTED' | 'INCONCLUSIVE';
export type DiagnosticId =
  | 'application'
  | 'kv-config'
  | 'doh-path'
  | 'upstream'
  | 'origin'
  | 'client-ip-family'
  | 'ip-enforcement';
export interface DiagnosticCheck {
  id: DiagnosticId;
  label: string;
  status: DiagnosticStatus;
  durationMs: number | null;
  summary: string;
  remedy?: string;
  // Stable machine-readable reason, for example "timeout" or "http-status".
  code?: string;
}
export type IpFamily = 'ipv4' | 'ipv6';
export interface DiagnosticReport {
  durationMs: number;
  provider: Provider;
  observedClientFamily: IpFamily | null;
  checks: DiagnosticCheck[];
}
