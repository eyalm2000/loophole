import { describe, it, expect } from 'vitest';
import { initialConfig } from '../shared/contracts';
import { validateConfig } from '../shared/validation';
import { resumeStep, domainReady } from '../shared/onboarding';
describe('onboarding progress', () => {
  it('preserves current progress and the chosen Android method across settings reads', () => {
    const config = validateConfig({
      ...initialConfig,
      onboardingStep: 7,
      androidMethod: 'adb',
    });
    expect(config.androidMethod).toBe('adb');
    expect(resumeStep(config)).toBe(7);
  });
  it('rejects unsupported method values', () => {
    expect(() => validateConfig({ ...initialConfig, androidMethod: 'root' })).toThrow();
  });
  it.each(['onboardingStep', 'androidMethod', 'updatedAt'])(
    'requires the current %s field',
    (field) => {
      const config: Record<string, unknown> = { ...initialConfig };
      delete config[field];
      expect(() => validateConfig(config)).toThrow();
    },
  );
  it('requires the configured custom domain before advancing, with a local development exception', () => {
    expect(domainReady('gateway.account.workers.dev', 'dns.example.com')).toBe(false);
    expect(domainReady('other.example.com', 'dns.example.com')).toBe(false);
    expect(domainReady('dns.example.com', 'dns.example.com')).toBe(true);
    expect(domainReady('127.0.0.1', 'dns.example.com')).toBe(true);
  });
  it('accepts the final step and rejects progress outside the current setup', () => {
    expect(validateConfig({ ...initialConfig, onboardingStep: 9 }).onboardingStep).toBe(9);
    expect(() => validateConfig({ ...initialConfig, onboardingStep: 10 })).toThrow();
  });
  it('requires the domain handoff when resuming later incomplete progress off-domain', () => {
    const config = { ...initialConfig, domain: 'dns.example.com', onboardingStep: 8 };
    expect(resumeStep(config, 'gateway.account.workers.dev')).toBe(2);
    expect(resumeStep(config, 'dns.example.com')).toBe(8);
  });
});
