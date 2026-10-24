import { providers, type Config } from './contracts';

export function hostname(value: unknown, allowEmpty = false): string {
  if (allowEmpty && value === '') return '';
  if (typeof value !== 'string') throw new Error('Enter a valid hostname.');
  const host = value.trim().toLowerCase().replace(/\.$/, '');
  if (
    host.length > 253 ||
    !host.includes('.') ||
    !host.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    /^\d+(\.\d+)+$/.test(host)
  )
    throw new Error('Enter a hostname without https:// or a path.');
  return host;
}
export function validateConfig(value: unknown): Config {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid settings.');
  const item = value as Record<string, unknown>;
  if (!providers.some((p) => p.id === item.provider))
    throw new Error('Choose a supported provider.');
  const text = (key: string, max: number) => {
    const field = item[key];
    if (typeof field !== 'string' || field.length > max || /[\x00-\x1f\x7f]/.test(field))
      throw new Error(`Invalid ${key}.`);
    return field.trim();
  };
  const nextdnsId = text('nextdnsId', 6);
  if ((item.provider === 'nextdns' || nextdnsId) && !/^[a-f0-9]{6}$/i.test(nextdnsId))
    throw new Error('NextDNS profile IDs contain six hexadecimal characters.');
  if (typeof item.onboardingComplete !== 'boolean') throw new Error('Invalid onboarding state.');
  const deviceName = text('deviceName', 64);
  if (deviceName === '.' || deviceName === '..')
    throw new Error('Device names cannot be a URL dot segment.');
  const onboardingStep = item.onboardingStep;
  const androidMethod = item.androidMethod;
  if (!['shizuku', 'adb', 'unknown'].includes(String(androidMethod)))
    throw new Error('Invalid Android setup method.');
  if (!Number.isInteger(onboardingStep) || Number(onboardingStep) < 0 || Number(onboardingStep) > 9)
    throw new Error('Invalid setup progress.');
  return {
    provider: item.provider as Config['provider'],
    nextdnsId: nextdnsId.toLowerCase(),
    deviceName,
    customDohUrl: text('customDohUrl', 2048),
    domain: hostname(item.domain, true),
    onboardingComplete: item.onboardingComplete,
    onboardingStep: Number(onboardingStep),
    androidMethod: androidMethod as Config['androidMethod'],
    revision: text('revision', 64),
    updatedAt: text('updatedAt', 32),
  };
}
