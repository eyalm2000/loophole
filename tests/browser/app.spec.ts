import { test, expect, type Page } from '@playwright/test';
import { initialConfig } from '../../shared/contracts';
import { makeQuery } from '../../worker/dns/wire';

test('requires the custom-domain handoff and skips an existing DNS record', async ({ page }) => {
  let config = {
    ...initialConfig,
    domain: 'dns.example.com',
    onboardingStep: 2,
    revision: 'first',
  };
  let checks = 0;
  await page.route(
    /^https:\/\/(gateway\.account\.workers\.dev|dns\.example\.com)\//,
    async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/setup-state')
        return route.fulfill({ json: { initialized: false } });
      if (url.pathname === '/api/config') {
        if (route.request().method() === 'PUT')
          config = { ...route.request().postDataJSON(), revision: 'saved' };
        return route.fulfill({ json: { config } });
      }
      if (url.pathname === '/api/verify-domain') {
        checks++;
        return route.fulfill({ json: { valid: true, issues: [] } });
      }
      return route.fulfill({
        response: await route.fetch({ url: `http://127.0.0.1:5173${url.pathname}${url.search}` }),
      });
    },
  );
  await page.goto('https://gateway.account.workers.dev/');
  await expect(page.getByRole('heading', { name: 'Connect your domain' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  expect(checks).toBe(0);
  await page.getByRole('link', { name: 'Open dns.example.com', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your domain is now set up' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose your resolver' })).toBeVisible();
  expect(config.onboardingStep).toBe(4);
  expect(checks).toBeGreaterThan(0);
  expect(new URL(page.url()).search).toBe('');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Choose your resolver' })).toBeVisible();
  await page.goto('https://gateway.account.workers.dev/');
  await expect(page.getByRole('heading', { name: 'Connect your domain' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  await page.getByRole('link', { name: 'Open dns.example.com', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your domain is now set up' })).toBeVisible();
});

async function enterPin(page: Page) {
  await page.getByLabel('Four-digit PIN').fill('2468');
  await page.getByRole('button', { name: 'Unlock dashboard' }).click();
}

test('minimal setup, question routes, resolver dialog and circular PIN keypad', async ({
  page,
  request,
}) => {
  let recordFound = false;
  let recordChecks = 0;
  await page.route('**/api/verify-domain', (route) => {
    recordChecks++;
    return route.fulfill({
      json: { valid: recordFound, issues: ['Waiting for the SVCB record.'] },
    });
  });
  await page.goto('/');
  expect((await request.get('http://127.0.0.1:8787/api/config')).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Your website is running' })).toBeVisible();
  await expect(page.getByText('You will need:', { exact: true })).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveText(['Android 16 or newer', 'A domain']);
  await expect(page.locator('svg')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/welcome.png', fullPage: true });
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page.getByRole('heading', { name: 'What domain will you use?' })).toBeVisible();
  await expect(page.getByRole('list')).toHaveCount(0);
  await page.getByLabel('Domain', { exact: true }).fill('nextdns.example.com');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connect your domain' })).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(3);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add the DNS record' })).toBeVisible();
  await expect(page.locator('.step-content .spinner')).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await page
      .locator('.step-content .spinner')
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
  const before = recordChecks;
  await expect.poll(() => recordChecks).toBeGreaterThan(before);
  recordFound = true;
  await expect(page.getByRole('heading', { name: 'Choose your resolver' })).toBeVisible();
  await page.route('**/api/test', (route) =>
    route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Proposed resolver is unavailable.' }),
    }),
  );
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Proposed resolver is unavailable.');
  await page.unroute('**/api/test');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose PIN' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Choose PIN' })).toBeVisible();
  await page.getByLabel('Four-digit PIN').fill('2468');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Four-digit PIN').fill('2468');
  await page.getByRole('button', { name: 'Set PIN', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Do you use Shizuku or ADB?' })).toBeVisible();
  expect((await request.get('http://127.0.0.1:8787/api/config')).status()).toBe(401);
  await page
    .getByRole('button', { name: 'I don’t use either / I’m not sure', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Set up Shizuku' })).toBeVisible();
  await expect(
    page.getByText('device_config put connectivity dns_ddr_version 1', { exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Run the commands' })).toBeVisible();
  await expect(
    page.getByText('device_config put connectivity dns_ddr_version 1', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Required: turn Airplane mode on, wait a few seconds, then turn it off.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await page.getByRole('button', { name: 'ADB', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Set up ADB' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(
    page.getByText('adb shell device_config put connectivity dns_ddr_version 1', { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/adb-instructions.png', fullPage: true });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Open dashboard' }).click();
  const banner = page.getByRole('status', { name: 'DNS connection' });
  await expect(banner).toContainText('Not connected through your DNS');
  await expect(page.getByRole('button', { name: 'Setup instructions' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /ADNS/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Run test' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Change resolver' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose your resolver' });
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: 'test-results/resolver-dialog.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Change resolver' })).toBeFocused();
  await page.getByRole('button', { name: 'Change resolver' }).click();
  await dialog.getByRole('radio', { name: 'AdGuard DNS', exact: true }).check();
  await dialog.getByRole('button', { name: 'Save settings' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('status', { name: 'Settings update' })).toContainText(
    'Updates can take a few minutes',
  );
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 360, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/dashboard-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Enter PIN' })).toBeVisible();
  const digit = page.getByRole('button', { name: '2', exact: true });
  const circle = await digit.evaluate((el) => ({
    width: el.getBoundingClientRect().width,
    height: el.getBoundingClientRect().height,
    radius: getComputedStyle(el).borderRadius,
  }));
  expect(circle.width).toBe(circle.height);
  expect(circle.radius).toBe('50%');
  await page.screenshot({ path: 'test-results/pin-mobile.png', fullPage: true });
  await enterPin(page);
  await expect(banner).toBeVisible();
});

test('requires fresh browser DNS and clears connected after DNS stops or polling fails', async ({
  page,
  request,
}) => {
  let observed = false;
  let sendQueries = true;
  let polls = 0;
  await page.route('**/api/status*', (route) => {
    polls++;
    return route.continue();
  });
  // Local Edge cannot use our local DoH endpoint as its system resolver. Emulate
  // that one DNS lookup at the gateway, while retaining real API/DO/upstream IO.
  await page.route('https://*.dns-check.nextdns.example.com/**', async (route) => {
    if (!sendQueries) return route.abort();
    const hostname = new URL(route.request().url()).hostname;
    const response = await request.post('http://127.0.0.1:8787/dns-query', {
      headers: { 'content-type': 'application/dns-message', 'cf-connecting-ip': '2001:db8::123' },
      data: Buffer.from(makeQuery(hostname)),
    });
    expect(response.status()).toBe(200);
    observed = true;
    await route.abort();
  });
  await page.goto('/');
  await enterPin(page);
  const banner = page.getByRole('status', { name: 'DNS connection' });
  await expect.poll(() => observed).toBe(true);
  await expect(banner).toHaveText('Connected through your DNS');
  await page.screenshot({ path: 'test-results/connected.png', fullPage: true });
  const before = polls;
  await expect.poll(() => polls).toBeGreaterThan(before);
  sendQueries = false;
  await expect(banner).toHaveText('Not connected through your DNS', { timeout: 8000 });
  sendQueries = true;
  await expect(banner).toHaveText('Connected through your DNS', { timeout: 8000 });
  // Returning from Android settings must discard the earlier proof immediately.
  sendQueries = false;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(banner).toHaveText('Not connected through your DNS');
  sendQueries = true;
  await expect(banner).toHaveText('Connected through your DNS', { timeout: 8000 });
  await page.unroute('**/api/status*');
  await page.route('**/api/status*', (route) =>
    route.fulfill({ status: 503, json: { error: 'Temporarily offline' } }),
  );
  await expect(banner).toContainText('Status unavailable. Retrying.');
  await expect(banner).toContainText('DNS status unavailable');
  await expect(banner).toHaveAttribute('data-state', 'unavailable');
});

test('real upstream DNS works through GET and POST at the local gateway', async ({ request }) => {
  const home = await request.get('http://127.0.0.1:8787/');
  expect(home.status()).toBe(200);
  expect(home.headers()['x-frame-options']).toBe('DENY');
  expect(home.headers()['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');
  expect(home.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  const script = (await home.text()).match(/src="([^"]+\.js)"/)![1];
  const asset = await request.get('http://127.0.0.1:8787' + script);
  expect(asset.status()).toBe(200);
  expect(asset.headers()['content-security-policy']).toBe(
    home.headers()['content-security-policy'],
  );
  const query = Buffer.from([
    0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 7, 101, 120, 97, 109, 112, 108, 101, 3, 99, 111, 109, 0, 0,
    1, 0, 1,
  ]);
  for (const method of ['GET', 'POST']) {
    const response =
      method === 'GET'
        ? await request.get('http://127.0.0.1:8787/dns-query?dns=' + query.toString('base64url'))
        : await request.post('http://127.0.0.1:8787/dns-query', {
            headers: { 'content-type': 'application/dns-message' },
            data: query,
          });
    expect(response.status(), await response.text()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/dns-message');
    const bytes = await response.body();
    expect(bytes[2] & 128).toBe(128);
    expect(bytes[3] & 15).toBe(0);
  }
});

test('management API requires authentication and rejects foreign origins', async ({ request }) => {
  expect((await request.get('http://127.0.0.1:8787/api/config')).status()).toBe(401);
  expect(
    (
      await request.post('http://127.0.0.1:8787/api/login', {
        headers: { origin: 'https://attacker.example.com' },
        data: { pin: '2468' },
      })
    ).status(),
  ).toBe(403);
  expect((await request.get('http://127.0.0.1:8787/api/unknown')).status()).toBe(404);
});
