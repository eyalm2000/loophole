import { useEffect, useState } from 'react';
import type { Config, TestResult, Verification } from '../../../shared/contracts';
import { resumeStep, domainReady } from '../../../shared/onboarding';
import { hostname } from '../../../shared/validation';
import { api } from '../../lib/api';
import { CopyCard, ErrorText, ExternalLink, Spinner } from '../ui';
import { ProviderForm } from '../ProviderForm';
import { PinScreen } from '../PinScreen';
import { AndroidGuide } from './AndroidGuide';
import { AndroidCommands } from './AndroidCommands';
import { SvcbStep } from './SvcbStep';
import { useVerification } from '../../hooks/useVerification';

export function OnboardingWizard({
  config,
  save,
  finish,
  pinSet,
  onPinSet,
}: {
  config: Config;
  save: (value: Config, quiet?: boolean) => Promise<void>;
  finish: () => void;
  pinSet: boolean;
  onPinSet: () => Promise<void>;
}) {
  const [step, setStep] = useState(
    new URLSearchParams(location.search).has('domain-setup')
      ? 2
      : resumeStep(config, location.hostname),
  );
  useEffect(() => {
    const url = new URL(location.href);
    if (url.searchParams.has('domain-setup')) {
      url.searchParams.delete('domain-setup');
      history.replaceState(null, '', url);
    }
  }, []);
  const [draft, setDraft] = useState(config),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const custom =
    !location.hostname.endsWith('.workers.dev') &&
    !['localhost', '127.0.0.1'].includes(location.hostname);
  const [domain, setDomain] = useState(config.domain || (custom ? location.hostname : ''));
  const method = draft.androidMethod === 'adb' ? 'adb' : 'shizuku';
  const ready = domainReady(location.hostname, config.domain);
  const verification = useVerification(config.domain, ready && (step === 2 || step === 3));
  useEffect(() => {
    if (step === 3 && verification.result?.valid && !busy && !error) void advance();
  }, [step, verification.result]);
  async function advance(overrides: Partial<Config> = {}) {
    setBusy(true);
    setError('');
    try {
      if ((step === 2 || step === 3) && !ready)
        throw new Error('Open your website at the custom domain to continue.');
      if (step === 3 && !verification.result?.valid)
        throw new Error('Wait until the DNS record is detected.');
      const next = {
        ...config,
        ...draft,
        ...overrides,
        revision: config.revision,
        onboardingStep: step === 4 && pinSet ? 6 : Math.min(step + 1, 9),
      };
      if (step === 1) {
        next.domain = hostname(domain);
        if (next.domain.endsWith('.workers.dev')) throw new Error('Enter a custom domain.');
        setDomain(next.domain);
      }
      if (step === 4) {
        const test = await api<TestResult>('test', 'POST', { config: next });
        if (!test.ok)
          throw new Error('The resolver could not complete a DNS query. Check its settings.');
      }
      if (step === 2) {
        const result = await api<Verification>('verify-domain', 'POST', { domain: config.domain });
        if (result.valid) next.onboardingStep = 4;
      }
      if (step === 9) next.onboardingComplete = true;
      await save(next, true);
      setDraft(next);
      if (step === 9) finish();
      else setStep(next.onboardingStep);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const titles = [
    'Loophole is running',
    'What domain will you use?',
    location.hostname === config.domain ? 'Your domain is now set up' : 'Connect your domain',
    'Add the DNS record',
    'Choose your resolver',
    'Choose PIN',
    'Do you use Shizuku or ADB?',
    method === 'adb' ? 'Set up ADB' : 'Set up Shizuku',
    'Run the commands',
    'Set Private DNS',
  ];
  if (step === 5)
    return (
      <section>
        <PinScreen
          setup
          onBack={() => setStep(4)}
          onSuccess={async () => {
            await onPinSet();
            setStep(6);
          }}
        />
      </section>
    );
  return (
    <form
      className="wizard"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && step !== 6) void advance();
      }}
    >
      <h1>{titles[step]}</h1>
      <div className="step-content" key={step}>
        {step === 0 && (
          <>
            <p>
              Connect your domain, choose a DNS resolver, and set a PIN to protect your Loophole
              dashboard. Then we’ll walk you through setting up your phone.
            </p>
            <p>You will need:</p>
            <ul>
              <li>Android 16 or newer</li>
              <li>A domain</li>
            </ul>
            <p className="muted">
              Keep your Cloudflare dashboard and Android phone nearby. You can leave and resume
              setup from this website.
            </p>
          </>
        )}
        {step === 1 && (
          <label>
            Domain
            <input
              required
              placeholder="dns.example.com"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              autoCapitalize="none"
              spellCheck={false}
            />
          </label>
        )}
        {step === 2 &&
          (location.hostname === config.domain ? (
            <p>
              Loophole is running at <strong>{config.domain}</strong>. Continue to check your DNS
              record.
            </p>
          ) : (
            <>
              <ol>
                <li>
                  Open your Worker in the{' '}
                  <ExternalLink href="https://dash.cloudflare.com/">
                    Cloudflare dashboard
                  </ExternalLink>
                  .
                </li>
                <li>Go to Settings → Domains & Routes → Add Custom Domain.</li>
                <li>
                  Enter <strong>{config.domain}</strong> and wait for the domain to become active.
                </li>
              </ol>
              <p>
                Open Loophole at the new domain to continue setup. This page cannot continue on the
                Workers address.
              </p>
              <a className="button secondary" href={`https://${config.domain}/?domain-setup=1`}>
                Open {config.domain}
              </a>
            </>
          ))}
        {step === 3 && <SvcbStep domain={config.domain} {...verification} />}
        {step === 4 && <ProviderForm value={draft} onChange={setDraft} disabled={busy} />}
        {step === 6 && (
          <div className="choice-list">
            {(
              [
                ['shizuku', 'Shizuku'],
                ['adb', 'ADB'],
                ['shizuku', 'I don’t use either / I’m not sure'],
              ] as const
            ).map(([value, label]) => (
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                key={label}
                onClick={() => void advance({ androidMethod: value })}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {step === 7 && <AndroidGuide method={method} />}
        {step === 8 && <AndroidCommands method={method} />}
        {step === 9 && (
          <>
            <ol>
              <li>Open Android Settings → Network & internet → Private DNS.</li>
              <li>Select “Private DNS provider hostname”.</li>
              <li>Enter the hostname below and save.</li>
            </ol>
            <CopyCard value={config.domain} label="Hostname" />
          </>
        )}
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="wizard-actions">
        {step > 0 && (
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => {
              setError('');
              setStep(step === 6 && pinSet ? 4 : step - 1);
            }}
          >
            Previous
          </button>
        )}
        {step !== 6 && (
          <button
            className="button"
            type="submit"
            disabled={
              busy ||
              (step === 1 && !domain.trim()) ||
              ((step === 2 || step === 3) && !ready) ||
              (step === 3 && !verification.result?.valid)
            }
          >
            {busy && <Spinner />}
            {busy
              ? 'Saving…'
              : step === 0
                ? 'Get started'
                : step === 9
                  ? 'Open dashboard'
                  : 'Continue'}
          </button>
        )}
      </div>
    </form>
  );
}
