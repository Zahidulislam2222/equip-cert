/**
 * Real browser flows against the local stack (Rule 15 step 2: exercise the real UI for every
 * criterion). Serial: later steps use the organisation and accounts earlier steps created.
 *
 * Covers: email-confirmed signup -> server-side provisioning (DEF-076 path), the invitation round
 * trip into an existing tenant, Team, Reports + CSV, billing "not configured" honesty, the help
 * assistant's disclosure and fallback, and axe accessibility scans of each page.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { admin, RUN } from '../local/stack.mjs';
import { MAILPIT_URL } from './settings.mjs';

test.describe.configure({ mode: 'serial' });

const PASSWORD = `Brw-${RUN}-${Math.random().toString(36).slice(2)}-Zq9!`;
const owner = { name: `Olive Owner-${RUN}`, email: `brw-owner-${RUN}@example.test`, org: `Browser Test Co ${RUN}` };
const tech = { name: `Theo Tech-${RUN}`, email: `brw-tech-${RUN}@example.test` };
let orgId = '';
let ownerState = null;

/**
 * Known, recorded, owner-decision findings — NOT passes. Each names its DEFECT-LOG entry. A node
 * is excused only when the rule AND the selector both match; anything else fails the test.
 *
 * DEF-080: three small texts sit below 4.5:1 — the landing-page inspection record dims
 * not-yet-reached lines to opacity 45 % (InspectionRecord.tsx), the landing step captions use
 * muted-foreground at 65 % (src/app/page.tsx), and the cookie-name captions in the consent controls use it at 80 % on 10 px
 * text (ConsentControls.tsx / CookieConsent.tsx). Fixing any of them is a visual change behind the
 * DEF-041 design fence, so they wait for the owner. Everything else must be clean.
 */
const KNOWN = [
  { rule: 'color-contrast', selector: /\.opacity-45/, ref: 'DEF-080' },
  { rule: 'color-contrast', selector: /text-muted-foreground\W*65\.tracking-wider/, ref: 'DEF-080' },
  { rule: 'color-contrast', selector: /mt-0\W*5\.block\.font-mono/, ref: 'DEF-080' },
];

/** Serious/critical axe findings on the current page (WCAG 2.x A/AA rules), minus KNOWN. */
async function axeSerious(page) {
  // Measure the settled page, not a frame of an entrance fade (opacity mid-transition fails contrast).
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1_000);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const excused = (v, n) => KNOWN.some((k) => k.rule === v.id && k.selector.test(n.target.join(' ')));
  return r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ ...v, nodes: v.nodes.filter((n) => !excused(v, n)) }))
    .filter((v) => v.nodes.length > 0)
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

/** The confirmation link Supabase mailed to `email`, read from the local Mailpit inbox. */
async function confirmationLink(email) {
  for (let i = 0; i < 30; i += 1) {
    const list = await (await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json();
    const id = list.messages?.[0]?.ID;
    if (id) {
      const msg = await (await fetch(`${MAILPIT_URL}/api/v1/message/${id}`)).json();
      const link = (msg.Text ?? msg.HTML ?? '').match(/https?:\/\/[^\s"<>]+\/auth\/v1\/verify[^\s"<>]+/)?.[0];
      if (link) return link.replace(/&amp;/g, '&');
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No confirmation email for ${email}`);
}

/** A page signed in as the owner created by the signup test. */
async function ownerPage(browser) {
  const ctx = await browser.newContext({ storageState: ownerState });
  return ctx.newPage();
}

async function fillSignup(page, who, orgName) {
  await page.locator('#signup-name').fill(who.name);
  if (orgName) await page.locator('#signup-org').fill(orgName);
  await page.locator('#signup-email').fill(who.email);
  await page.locator('#signup-password').fill(PASSWORD);
  await page.getByRole('button', { name: /create|sign up|get started/i }).click();
  await expect(page.getByText(/check your email/i)).toBeVisible();
}

test('public pages have no serious accessibility violations', async ({ page }) => {
  const found = {};
  for (const path of ['/', '/pricing', '/auth/login', '/auth/signup', '/privacy', '/terms']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const v = await axeSerious(page);
    if (v.length) found[path] = v;
  }
  expect(found).toEqual({});
});

test('a confirmation that lands on the site root is handed to sign-in', async ({ page }) => {
  // What the LIVE project does while its redirect allow list lacks the production URL.
  await page.goto('/#access_token=not-a-real-token&type=signup');
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 20_000 }).toBe('/auth/login');
  expect(new URL(page.url()).hash).toBe('#access_token=not-a-real-token&type=signup');
});

test('signup -> email confirmation -> the organisation is provisioned server-side', async ({ page }) => {
  await page.goto('/auth/signup');
  await fillSignup(page, owner, owner.org);

  await page.goto(await confirmationLink(owner.email));
  await page.waitForURL((u) => u.pathname.startsWith('/app/dashboard'));
  await expect(page.getByRole('heading', { name: 'Welcome back, Olive' })).toBeVisible();

  const { data: profile } = await admin.from('profiles').select('org_id, role, full_name').eq('full_name', owner.name).single();
  expect(profile?.role).toBe('admin');
  const { data: org } = await admin.from('organizations').select('id, name, plan').eq('id', profile.org_id).single();
  expect(org.name).toBe(owner.org);
  expect(org.plan).toBe('free');
  orgId = org.id;
  ownerState = await page.context().storageState();

  expect(await axeSerious(page), 'axe on dashboard').toEqual([]);
});

test('billing says it is not configured instead of failing silently', async ({ browser }) => {
  const page = await ownerPage(browser);
  await page.goto('/app/settings');
  const upgrade = page.getByRole('button', { name: /upgrade to/i });
  await expect(upgrade).toBeVisible();
  await upgrade.click();
  await expect(page.getByText(/not configured|unavailable|not set up/i).first()).toBeVisible();
  await expect(page).toHaveURL(/\/app\/settings/);
  expect(await axeSerious(page), 'axe on settings').toEqual([]);
});

test('an admin invites a technician who joins the SAME organisation', async ({ browser }) => {
  const page = await ownerPage(browser);
  // Team is a paid feature and the free plan has one seat: upgrade the fixture org directly
  // (service role — the browser cannot, which is DEF-077's fix).
  await admin.from('organizations').update({ plan: 'pro' }).eq('id', orgId);

  await page.goto('/app/team');
  await page.getByRole('button', { name: 'Create invitation link' }).click();
  const link = await page.getByRole('textbox', { name: 'Invitation link' }).inputValue();
  expect(link).toMatch(/\/auth\/signup#invite=[A-Za-z0-9_-]{20,}$/);
  expect(await axeSerious(page), 'axe on team').toEqual([]);

  const ctx = await browser.newContext();
  const invitee = await ctx.newPage();
  await invitee.goto(link.replace(/^https?:\/\/[^/]+/, ''));
  await expect(invitee.locator('#signup-org')).toHaveCount(0);
  await fillSignup(invitee, tech, null);
  await invitee.goto(await confirmationLink(tech.email));
  await invitee.waitForURL((u) => u.pathname.startsWith('/app/dashboard'));
  await expect(invitee.getByRole('heading', { name: 'Welcome back, Theo' })).toBeVisible();

  await expect
    .poll(async () => (await admin.from('profiles').select('org_id, role').eq('full_name', tech.name).maybeSingle()).data)
    .toEqual({ org_id: orgId, role: 'technician' });
  await ctx.close();

  await page.reload();
  await expect(page.getByText(tech.name, { exact: true }).first()).toBeVisible();
  // The invitation was single-use: it is consumed, so none is left open.
  await expect(page.getByText('No open invitations.')).toBeVisible();
});

test('reports summarise real inspections and export them as CSV', async ({ browser }) => {
  const page = await ownerPage(browser);
  const { data: p } = await admin.from('profiles').select('id').eq('full_name', owner.name).single();
  const rows = ['Lobby extinguisher', 'Kitchen hood', 'Boiler room hose'].map((name, i) => ({
    organization_id: orgId,
    inspector_id: p.id,
    inspector_name: owner.name,
    equipment_name: `${name} ${RUN}`,
    status: i === 1 ? 'Action Required' : 'Safe',
    checklist_data: [],
  }));
  const { error } = await admin.from('inspections').insert(rows);
  expect(error).toBeNull();

  await page.goto('/app/reports');
  await expect(page.getByRole('heading', { name: /by inspector/i })).toBeVisible();
  await expect(page.getByRole('cell', { name: owner.name })).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'CSV' }).click()]);
  const csv = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8'));
  for (const r of rows) expect(csv).toContain(r.equipment_name);
  expect(await axeSerious(page), 'axe on reports').toEqual([]);
});

test('help assistant discloses AI and falls back to a help article', async ({ browser }) => {
  const page = await ownerPage(browser);
  await page.goto('/app/dashboard');
  await page.getByRole('button', { name: /^help$/i }).click();
  const dialog = page.getByRole('dialog', { name: /help assistant/i });
  await expect(dialog.getByText(/AI assistant/i).first()).toBeVisible();
  await dialog.getByPlaceholder('Ask about using EquipCert…').fill('How do I invite a technician?');
  await dialog.getByRole('button', { name: 'Send' }).click();
  await expect(dialog.getByText('Help article (AI unavailable)')).toBeVisible();
  await expect(dialog.getByText(/invit/i).nth(1)).toBeVisible();
  expect(await axeSerious(page), 'axe with help dialog open').toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
