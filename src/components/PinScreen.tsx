import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { Keypad } from './Keypad';
import { ErrorText } from './ui';
export function PinScreen({
  setup = false,
  onSuccess,
  onBack,
}: {
  setup?: boolean;
  onSuccess: () => Promise<void>;
  onBack?: () => void;
}) {
  const [stage, setStage] = useState(setup ? 'choose' : 'login');
  const [pin, setPin] = useState(''),
    [first, setFirst] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit() {
    setError('');
    if (stage === 'choose') {
      setFirst(pin);
      setPin('');
      setStage('confirm');
      return;
    }
    if (stage === 'confirm' && pin !== first) {
      setError('PINs do not match. Try again.');
      setStage('choose');
      setFirst('');
      setPin('');
      return;
    }
    setBusy(true);
    try {
      await api(setup ? 'setup' : 'login', 'POST', { pin });
      setFirst('');
      setPin('');
      await onSuccess();
    } catch (error) {
      setError((error as Error).message);
      setPin('');
      if (error instanceof ApiError && error.status === 409)
        window.dispatchEvent(new Event('session-expired'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="pin-screen">
      <h1>
        {stage === 'choose' ? 'Choose PIN' : stage === 'confirm' ? 'Confirm PIN' : 'Enter PIN'}
      </h1>
      <Keypad
        value={pin}
        onChange={setPin}
        onSubmit={submit}
        onBack={
          onBack
            ? () => {
                setError('');
                setPin('');
                if (stage === 'confirm') {
                  setFirst('');
                  setStage('choose');
                } else onBack();
              }
            : undefined
        }
        busy={busy}
        submit={
          stage === 'choose' ? 'Continue' : stage === 'confirm' ? 'Set PIN' : 'Unlock Loophole'
        }
      />
      <ErrorText>{error}</ErrorText>
    </section>
  );
}
