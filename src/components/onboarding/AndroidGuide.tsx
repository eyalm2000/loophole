import { ExternalLink } from '../ui';
type Method = 'shizuku' | 'adb';
export function AndroidGuide({ method }: { method: Method }) {
  return (
    <div className="instructions-content">
      {method === 'shizuku' ? (
        <>
          <p>Shizuku lets you run the setup commands on your phone. No computer is needed.</p>
          <ol>
            <li>
              Install{' '}
              <ExternalLink href="https://shizuku.rikka.app/guide/setup/">Shizuku</ExternalLink> and
              open it. Follow its pairing instructions to enable Developer options and Wireless
              debugging on your phone.
            </li>
            <li>
              In Shizuku, tap Pairing and pair with your phone’s wireless debugging code. Return to
              Shizuku, tap Start, and wait until it says it is running.
            </li>
            <li>
              Install{' '}
              <ExternalLink href="https://github.com/DP-Hridayan/aShellYou">
                aShell You
              </ExternalLink>
              , open it, and allow Shizuku access.
            </li>
            <li>Keep aShell You open. On the next page, you’ll copy and run two commands there.</li>
          </ol>
        </>
      ) : (
        <>
          <p>ADB lets you run the setup commands from a computer connected to your phone.</p>
          <ol>
            <li>
              Download{' '}
              <ExternalLink href="https://developer.android.com/tools/releases/platform-tools">
                Android Platform Tools
              </ExternalLink>{' '}
              on your computer.
            </li>
            <li>
              Enable Developer options and USB debugging on your phone. Connect it by USB and
              approve the debugging prompt.
            </li>
            <li>
              Open a terminal in the platform-tools folder. Run <code>adb devices</code> to confirm
              your phone is listed as “device”. If it says “unauthorized”, unlock your phone and
              approve the prompt. Keep this terminal open for the next page.
            </li>
          </ol>
          <p className="muted">
            In Windows PowerShell, use <code>.\adb</code> instead of <code>adb</code> when running
            from the platform-tools folder.
          </p>
        </>
      )}
    </div>
  );
}
