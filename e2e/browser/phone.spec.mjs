/**
 * Phone-width checks (Pixel 7 project; tagged @phone). Self-contained: the account is created and
 * provisioned through the real RPC, then signed in through the real form.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { userWithSession, PASSWORD, RUN } from '../local/stack.mjs';

test('@phone sign in, open the menu, reach Help — with no serious accessibility violations', async ({ page }) => {
  const user = await userWithSession('phone', { full_name: `Pat Phone-${RUN}`, org_name: `Phone Co ${RUN}` });
  const { error } = await user.client.rpc('provision_account');
  expect(error).toBeNull();

  await page.goto('/auth/login');
  await page.locator('#login-email').fill(user.email);
  await page.locator('#login-password').fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((u) => u.pathname.startsWith('/app/dashboard'));
  await expect(page.getByRole('heading', { name: 'Welcome back, Pat' })).toBeVisible();

  // No horizontal scroll at phone width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: 'Open navigation menu' }).click();
  await expect(page.getByRole('link', { name: 'Settings' }).first()).toBeVisible();
  await page.keyboard.press('Escape');

  // The consent banner spans the bottom of a phone screen until answered; answer it the
  // privacy-preserving way, as a person would.
  await page.getByRole('button', { name: 'Reject optional' }).click();
  await page.getByRole('button', { name: /^help$/i }).click();
  await expect(page.getByRole('dialog', { name: /help assistant/i })).toBeVisible();

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1_000);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
  expect(serious).toEqual([]);
});
