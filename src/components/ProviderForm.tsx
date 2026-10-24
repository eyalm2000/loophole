import { providers, type Config } from '../../shared/contracts';
export function ProviderForm({
  value,
  onChange,
  disabled = false,
}: {
  value: Config;
  onChange: (value: Config) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="provider-form">
      <legend className="sr-only">DNS provider</legend>
      <div className="provider-options">
        {providers.map((p) => (
          <label className="provider-option" key={p.id}>
            <input
              type="radio"
              name="provider"
              value={p.id}
              checked={value.provider === p.id}
              onChange={() => onChange({ ...value, provider: p.id })}
            />
            <span>{p.name}</span>
          </label>
        ))}
      </div>
      {value.provider === 'nextdns' && (
        <div className="form-fields">
          <label>
            NextDNS profile ID
            <input
              required
              pattern="[a-fA-F0-9]{6}"
              maxLength={6}
              placeholder="abcdef"
              value={value.nextdnsId}
              onChange={(e) => onChange({ ...value, nextdnsId: e.target.value })}
            />
          </label>
          <label>
            Device name (optional)
            <input
              maxLength={64}
              value={value.deviceName}
              onChange={(e) => onChange({ ...value, deviceName: e.target.value })}
            />
          </label>
        </div>
      )}
      {value.provider === 'custom' && (
        <label>
          DoH endpoint
          <input
            type="url"
            required
            placeholder="https://resolver.example.com/dns-query"
            value={value.customDohUrl}
            onChange={(e) => onChange({ ...value, customDohUrl: e.target.value })}
          />
        </label>
      )}
    </fieldset>
  );
}
