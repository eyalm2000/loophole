import { CopyCard } from '../ui';

export function AndroidCommands({ method }: { method: 'shizuku' | 'adb' }) {
  const prefix = method === 'adb' ? 'adb shell ' : '';
  return (
    <div className="instructions-content">
      <p>
        {method === 'adb'
          ? 'In the computer terminal you opened, run each command separately. In Windows PowerShell, replace adb with .\\adb.'
          : 'In aShell You on your phone, paste the first command and tap Run. Then do the same with the second command.'}{' '}
        These enable Android’s encrypted DNS discovery and validation.
      </p>
      <CopyCard
        label="1. Enable DNS discovery"
        value={`${prefix}device_config put connectivity dns_ddr_version 1`}
      />
      <CopyCard
        label="2. Enable DNS validation"
        value={`${prefix}device_config put connectivity networkmonitor_async_privdns_resolution 1`}
      />
      <p>
        A successful command usually has no output. If you see an error, check that Shizuku is
        running or ADB has permission, then retry.
      </p>
      <p>
        <strong>Required: turn Airplane mode on, wait a few seconds, then turn it off.</strong> You
        must do this after running the commands so Android applies the changes. Without this step,
        the setup will not work.
      </p>
      <details>
        <summary>Check the settings</summary>
        <p>
          Run these two checks. Each should return <code>1</code>.
        </p>
        <CopyCard value={`${prefix}device_config get connectivity dns_ddr_version`} />
        <CopyCard
          value={`${prefix}device_config get connectivity networkmonitor_async_privdns_resolution`}
        />
      </details>
      <details>
        <summary>If the settings keep resetting</summary>
        <p>
          This disables DeviceConfig synchronization for the whole phone. Use it only if needed, and
          restore synchronization afterward.
        </p>
        <CopyCard
          label="Disable synchronization"
          value={`${prefix}device_config set_sync_disabled_for_tests persistent`}
        />
        <CopyCard
          label="Restore synchronization"
          value={`${prefix}device_config set_sync_disabled_for_tests none`}
        />
      </details>
    </div>
  );
}
