import type { Config } from './contracts';
export function resumeStep(config: Config, currentHost?: string): number {
  if (
    currentHost &&
    !config.onboardingComplete &&
    config.onboardingStep >= 2 &&
    !domainReady(currentHost, config.domain)
  )
    return 2;
  return config.onboardingStep;
}
export function domainReady(current: string, configured: string): boolean {
  if (['localhost', '127.0.0.1', '[::1]'].includes(current)) return true;
  return Boolean(configured) && !current.endsWith('.workers.dev') && current === configured;
}
