'use strict';
const { test, expect } = require('@playwright/test');

async function login(page) {
  await page.goto('/');
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password', { exact: true }).fill('ui-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#view h2')).toHaveText('Overview');
  await expect(page.locator('#stat-cards .metric')).toHaveCount(4);
}

test('all views render without JavaScript errors, including dark mode', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page);
  await page.screenshot({ path: 'test-results/overview-desktop.png', fullPage: true, animations: 'disabled' });
  for (const [route, heading] of [['channels', 'Channels'], ['routing', 'Smart routing'], ['tokens', 'Access tokens'], ['logs', 'Request logs'], ['settings', 'Settings']]) {
    await page.locator(`#nav [data-route="${route}"]`).click();
    await expect(page.locator('#view h2')).toHaveText(heading);
    await expect(page.locator('#view .empty').filter({ hasText: 'Loading…' })).toHaveCount(0);
  }
  await page.locator('#nav [data-route="routing"]').click();
  await expect(page.locator('.strategy-card')).toHaveCount(5);
  await page.screenshot({ path: 'test-results/routing-desktop.png', fullPage: true, animations: 'disabled' });
  await page.locator('#sidebar [data-theme-opt="dark"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'test-results/routing-dark.png', fullPage: true, animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('channel editor and selection support capacity and batch actions', async ({ page }) => {
  await login(page);
  await page.locator('#nav [data-route="channels"]').click();
  await page.getByRole('button', { name: 'Add channel', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill('UI temporary channel');
  await dialog.getByLabel('Base URL').fill('http://127.0.0.1:1');
  await dialog.getByLabel('Channel concurrency limit').fill('3');
  await dialog.locator('[name="keys"]').fill('sk-e2e-first\nsk-e2e-second');
  await dialog.getByRole('button', { name: 'Create channel' }).click();
  await expect(dialog).toBeHidden();
  const row = page.locator('[data-channel-row]').filter({ hasText: 'UI temporary channel' });
  await row.click();
  await expect(page.locator('[data-keysel]')).toHaveCount(2);
  await page.locator('[data-keysel-all]').check();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('[data-action="keys-batch"][data-operation="disable"]').click();
  await expect(page.locator('[data-key-badge]')).toHaveText(['disabled', 'disabled']);
  const channels = await (await page.request.get('/api/channels')).json();
  const channel = channels.find((ch) => ch.name === 'UI temporary channel');
  expect(channel.maxInflight).toBe(3);
  await page.request.delete('/api/channels/' + channel.id);
});

test('routing presets remain drafts, preview is free, and saving applies immediately', async ({ page }) => {
  await login(page);
  await page.locator('#nav [data-route="routing"]').click();
  await expect(page.locator('.strategy-card')).toHaveCount(5);
  const before = await (await page.request.get('/api/settings')).json();
  await page.getByRole('button', { name: 'Interactive', exact: true }).click();
  await expect(page.getByLabel('First-byte timeout (ms)')).toHaveValue('10000');
  expect((await (await page.request.get('/api/settings')).json()).firstByteTimeoutMs).toBe(before.firstByteTimeoutMs);
  await page.locator('#preview-model').fill('gpt-4o');
  await page.getByRole('button', { name: 'Preview route' }).click();
  await expect(page.locator('#routing-preview-result')).toContainText('Latency aware');
  await expect(page.locator('#routing-preview-result')).toContainText('eligible keys');
  await page.getByRole('button', { name: 'Save routing', exact: true }).click();
  await expect(page.locator('[data-save-status]')).toHaveText('All changes saved');
  expect((await (await page.request.get('/api/settings')).json()).firstByteTimeoutMs).toBe(10000);
  // Restore the fixture policy for subsequent cases.
  await page.request.put('/api/settings', { data: before });
});

test('log pause freezes live rows, resume catches up, and CSV exports the visible snapshot', async ({ page }) => {
  await login(page);
  await page.locator('#nav [data-route="logs"]').click();
  await expect(page.locator('#logs-tbody tr[data-log-row]')).not.toHaveCount(0);
  await page.getByRole('button', { name: 'Pause live' }).click();
  const first = await page.locator('#logs-tbody tr').first().getAttribute('data-log-row');
  const tokens = await (await page.request.get('/api/tokens')).json();
  const response = await page.request.post('/v1/chat/completions', { headers: { authorization: 'Bearer ' + tokens[0].token }, data: { model: 'gpt-4o', messages: [{ role: 'user', content: 'UI log test' }] } });
  expect(response.status()).toBe(200);
  await expect(page.locator('#log-status')).toContainText('Live updates paused');
  expect(await page.locator('#logs-tbody tr').first().getAttribute('data-log-row')).toBe(first);
  await page.getByRole('button', { name: 'Resume live' }).click();
  await expect(page.locator('#logs-tbody tr').first()).not.toHaveAttribute('data-log-row', first);
  await page.getByLabel('Retried only').check();
  await expect(page.locator('#logs-tbody .badge-cooldown').first()).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/^hivekey-requests-.*\.csv$/);
});

test('mobile navigation, modal focus and Chinese localization stay usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await expect(page.getByRole('button', { name: 'Open navigation' })).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.locator('#sidebar [data-lang-sel]').selectOption('zh-CN');
  await expect(page.locator('#view h2')).toHaveText('运行概览');
  await page.screenshot({ path: 'test-results/overview-mobile-zh.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: '添加渠道', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#shell')).not.toHaveAttribute('inert', '');
});

test('dirty routing forms survive live refresh, and navigation requires confirmation', async ({ page }) => {
  await login(page);
  await page.locator('#nav [data-route="routing"]').click();
  const input = page.getByLabel('First-byte timeout (ms)');
  await input.fill('32100');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(input).toHaveValue('32100');
  await expect(page.locator('[data-save-status]')).toHaveText('Unsaved changes');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('#nav [data-route="channels"]').click();
  await expect(page).toHaveURL(/#\/routing$/);
  await expect(input).toHaveValue('32100');
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#nav [data-route="channels"]').click();
  await expect(page.locator('#view h2')).toHaveText('Channels');
});

test('access tokens stay masked until explicitly revealed', async ({ page }) => {
  await login(page);
  await page.locator('#nav [data-route="tokens"]').click();
  const tokens = await (await page.request.get('/api/tokens')).json();
  await expect(page.locator('#tokens-tbody [data-action="token-reveal"]')).not.toHaveCount(0);
  await expect(page.locator('#tokens-tbody')).not.toContainText(tokens[0].token);
  await page.locator('[data-action="token-reveal"]').first().click();
  await expect(page.locator('#tokens-tbody')).toContainText(tokens[0].token);
  await page.locator('[data-action="token-reveal"]').first().click();
  await expect(page.locator('#tokens-tbody')).not.toContainText(tokens[0].token);
});

test('channel model selector, key editor and dialog focus remain functional', async ({ page }) => {
  await login(page);
  await page.locator('#nav [data-route="channels"]').click();
  await page.locator('[data-channel-row]').filter({ hasText: 'Primary · East' }).locator('[data-action="channel-edit"]').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('#modal-keys')).toContainText('sk-ui');
  await dialog.getByRole('button', { name: 'Fetch models', exact: true }).click();
  await dialog.locator('[data-model-input]').fill('gpt-4o');
  await page.keyboard.press('Enter');
  await expect(dialog.locator('[data-model-box]')).toContainText('gpt-4o');
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-action="modal-close"]').last().focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
