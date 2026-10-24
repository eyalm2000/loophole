import { Spinner } from './ui';

export function Keypad({
  value,
  onChange,
  onSubmit,
  onBack,
  busy,
  submit = 'Unlock dashboard',
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onBack?: () => void;
  busy: boolean;
  submit?: string;
}) {
  return (
    <form
      className="pin-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.length === 4 && !busy) onSubmit();
      }}
    >
      <label className="pin-entry">
        <span className="sr-only">Four-digit PIN</span>
        <input
          aria-label="Four-digit PIN"
          type="password"
          inputMode="numeric"
          pattern="[0-9]{4}"
          autoComplete="off"
          maxLength={4}
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, ''))}
          disabled={busy}
        />
        <span className="pin-dots" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={i < value.length ? 'filled' : ''} />
          ))}
        </span>
      </label>
      <div className="keypad" aria-label="PIN keypad">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <button
            type="button"
            key={n}
            disabled={busy || value.length >= 4}
            onClick={() => onChange(value + n)}
          >
            {n}
          </button>
        ))}
        <span />
        <button
          type="button"
          disabled={busy || value.length >= 4}
          onClick={() => onChange(value + '0')}
        >
          0
        </button>
        <button
          type="button"
          className="delete-digit"
          aria-label="Delete last digit"
          disabled={busy || !value}
          onClick={() => onChange(value.slice(0, -1))}
        >
          ⌫
        </button>
      </div>
      <div className="pin-actions">
        {onBack && (
          <button className="button secondary" type="button" disabled={busy} onClick={onBack}>
            Previous
          </button>
        )}
        <button className="button" type="submit" disabled={busy || value.length !== 4}>
          {busy && <Spinner />}
          {busy ? 'Please wait…' : submit}
        </button>
      </div>
    </form>
  );
}
