/**
 * Behaviour under the PRODUCTION Content-Security-Policy. The local server does not send the CSP
 * (Caddy / Vercel do, generated from vercel.json), so this test injects the exact policy from
 * vercel.json into every HTML response and checks what the browser really allows.
 *
 * Review finding 2026-11-25: signing called fetch() on the signature's data: URL. connect-src has
 * no `data:`, so production would block it and every signed submission would fail. The fix decodes
 * locally (src/lib/data-url.ts); this test pins the browser behaviour that made it necessary.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../../scripts/lib/ops-env.mjs';

const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
const CSP = vercel.headers
  .flatMap((h) => h.headers)
  .find((h) => h.key === 'Content-Security-Policy').value
  // upgrade-insecure-requests would rewrite the local http:// assets to https:// and break the page.
  .replace(/\s*upgrade-insecure-requests;?/, '');

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    const response = await route.fetch();
    const type = response.headers()['content-type'] ?? '';
    if (!type.includes('text/html')) return route.fulfill({ response });
    return route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': CSP } });
  });
});

test('under the production CSP, fetch() of a data: URL is blocked — and local decoding is not', async ({ page }) => {
  const violations = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  await page.goto('/auth/login');
  await expect(page.locator('#login-email')).toBeVisible();

  const result = await page.evaluate(async () => {
    const url = 'data:image/png;base64,iVBORw0KGgo=';
    let fetchOk;
    try {
      await (await fetch(url)).blob();
      fetchOk = true;
    } catch {
      fetchOk = false;
    }
    // The same decoding src/lib/data-url.ts does: no network permission involved.
    const bin = atob(url.split(',')[1]);
    const decoded = new Blob([Uint8Array.from(bin, (c) => c.charCodeAt(0))], { type: 'image/png' });
    return { fetchOk, decodedSize: decoded.size };
  });

  expect(result.fetchOk, 'the production CSP allowed fetch(data:) — the policy changed').toBe(false);
  expect(result.decodedSize).toBe(8);
  expect(violations.some((v) => v.includes('connect-src'))).toBe(true);
});

test('the sign-in page itself loads with no CSP violations', async ({ page }) => {
  const violations = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  await page.goto('/auth/login');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#login-email')).toBeVisible();
  expect(violations).toEqual([]);
});
