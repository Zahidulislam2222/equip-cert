/**
 * The technician's real work, end to end, through the UI (E2E pass 2026-11-25):
 *
 *   manual inspection -> photo -> GPS -> checklist -> ESIGN consent -> signature -> submit,
 *   a failed item -> corrective action, the free plan's unsigned path, the offline queue (and its
 *   hold for another user's signed item), equipment, and removing a member who has signed records.
 *
 * Every page runs under the PRODUCTION Content-Security-Policy from vercel.json — only the local
 * Supabase origin is added to connect-src so the browser can reach the local stack. A flow that
 * works here but needs a source production does not allow fails here first (DEF-082 lesson).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { admin, userWithSession, PASSWORD, RUN, stack } from '../local/stack.mjs';
import { ROOT } from '../../scripts/lib/ops-env.mjs';
import { BASE_URL } from './settings.mjs';

test.describe.configure({ mode: 'serial' });
// The production CSP is injected by route.fulfill, which makes Chrome treat the page as non-local
// and block its calls to the loopback Supabase (Local Network Access). Production has no loopback
// backend, so this check is irrelevant to it; switching it off keeps the CSP itself real.
test.use({ launchOptions: { args: ['--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults'] } });

const PHOTO = join(ROOT, 'public', 'icon-512.png');
const GEO = { latitude: 51.5074, longitude: -0.1278 };

/** The production CSP, with the local Supabase origin allowed and HTTPS upgrading removed. */
function productionCsp() {
  const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
  const header = vercel.headers
    .flatMap((h) => h.headers)
    .find((h) => h.key.toLowerCase() === 'content-security-policy');
  const local = new URL(stack.url);
  return header.value
    .replace(/upgrade-insecure-requests;?/, '')
    .replace('connect-src', `connect-src ${local.origin} ws://${local.host}`);
}
const CSP = productionCsp();

/** A browser context that behaves like production: CSP on every document, GPS granted. */
async function prodContext(browser) {
  const ctx = await browser.newContext({ permissions: ['geolocation'], geolocation: GEO });
  await ctx.route(`${BASE_URL}/**`, async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const res = await route.fetch();
    await route.fulfill({ response: res, headers: { ...res.headers(), 'content-security-policy': CSP } });
  });
  return ctx;
}

function watchCsp(page) {
  const violations = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  return violations;
}

async function signIn(page, user) {
  await page.goto('/auth/login');
  await page.locator('#login-email').fill(user.email);
  await page.locator('#login-password').fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((u) => u.pathname.startsWith('/app/'));
  // Answer the consent banner the privacy-preserving way, as a person would: until answered it
  // covers the bottom-left of the screen, including the left edge of the signature pad.
  const reject = page.getByRole('button', { name: 'Reject optional' });
  if (await reject.isVisible().catch(() => false)) await reject.click();
}

/** An admin with a provisioned organisation on `plan`, plus `techs` technicians invited into it. */
async function organisation(label, plan, techs = 1) {
  const owner = await userWithSession(`${label}-owner`, { full_name: `Owner ${label}`, org_name: `Field ${label} ${RUN}` });
  const { data: orgId, error } = await owner.client.rpc('provision_account');
  expect(error).toBeNull();
  await admin.from('organizations').update({ plan }).eq('id', orgId);
  // A registered extinguisher on a monthly schedule, long overdue: filing an inspection must clear it.
  const { data: eq } = await admin
    .from('equipment')
    .insert({ organization_id: orgId, name: `Stair extinguisher ${label}`, type: 'Fire Extinguisher', next_due_date: '2020-01-01' })
    .select('id')
    .single();
  await admin.from('schedules').insert({ organization_id: orgId, equipment_id: eq.id, frequency: 'monthly', next_due: '2020-01-01' });
  const members = [];
  for (let i = 0; i < techs; i += 1) {
    const { data } = await owner.client.rpc('create_invite', { p_role: 'technician', p_valid_hours: 24 });
    const token = (Array.isArray(data) ? data[0] : data).token;
    const tech = await userWithSession(`${label}-tech${i}`, { full_name: `Tech${i} ${label}` });
    const { error: joinError } = await tech.client.rpc('accept_invite', { p_token: token });
    expect(joinError).toBeNull();
    const { data: p } = await admin.from('profiles').select('id').eq('user_id', tech.id).single();
    members.push({ ...tech, profileId: p.id });
  }
  return { orgId, owner, members, equipmentId: eq.id };
}

/** Drive the manual inspection screen up to (not including) the submit button. */
async function fillInspection(page, { fail = false, sign = true } = {}) {
  await page.goto('/app/inspect');
  await page.getByRole('button', { name: /manual/i }).first().click();
  await expect(page.getByRole('button', { name: 'Choose the Equipment' })).toBeDisabled();
  await page.getByLabel('Equipment', { exact: true }).selectOption({ index: 1 });
  await expect(page.getByText('Fetching Safety Rules...')).toHaveCount(0, { timeout: 30_000 });

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Scan Equipment' }).click();
  await (await chooser).setFiles(PHOTO);
  await expect(page.getByAltText('Equipment')).toBeVisible();

  await page.getByRole('button', { name: 'Capture GPS Location' }).click();
  await expect(page.getByText('Location Captured')).toBeVisible();

  const passes = page.getByRole('button', { name: /^Pass: / });
  const n = await passes.count();
  expect(n, 'the checklist loaded at least one item').toBeGreaterThan(0);
  for (let i = 0; i < n; i += 1) {
    if (fail && i === 0) await page.getByRole('button', { name: /^Fail: / }).first().click();
    else await passes.nth(i).click();
  }

  if (sign) {
    await page.getByRole('button', { name: 'Add Digital Signature' }).click();
    await page.getByRole('checkbox').click(); // the consent box hides itself once ticked
    const canvas = page.locator('canvas').first();
    // The panel springs open: measure only once it has settled in view.
    await canvas.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + 20, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 90, { steps: 8 });
    await page.mouse.move(box.x + 220, box.y + 50, { steps: 8 });
    await page.mouse.up();
    await page.getByRole('button', { name: 'Confirm Signature' }).click();
    await expect(page.getByText('Signature captured')).toBeVisible();
  }
}

let pro; // shared pro-plan organisation

test('a technician files a signed inspection with photo, GPS and consent', async ({ browser }) => {
  pro = await organisation('pro', 'pro', 2);
  const tech = pro.members[0];
  const ctx = await prodContext(browser);
  const page = await ctx.newPage();
  const csp = watchCsp(page);
  await signIn(page, tech);

  await fillInspection(page);
  await page.getByRole('button', { name: /Sign & Submit Inspection/ }).click();
  await expect(page.getByRole('heading', { name: 'Inspection Complete!' })).toBeVisible();

  const { data: rows } = await admin
    .from('inspections')
    .select('id, inspector_id, equipment_id, photo_url, signature_url, location_lat, status, checklist_data')
    .eq('organization_id', pro.orgId);
  expect(rows).toHaveLength(1);
  const row = rows[0];
  expect(row.inspector_id).toBe(tech.profileId);
  expect(row.equipment_id).toBe(pro.equipmentId);
  expect(row.photo_url).toMatch(new RegExp(`^${pro.orgId}/`));
  expect(row.signature_url).toMatch(new RegExp(`^${pro.orgId}/`));
  expect(row.location_lat).toBeCloseTo(GEO.latitude, 3);
  expect(row.status).toBe('Safe');

  // The inspection named a registered asset, so its schedule and due date moved forward (DEF-092).
  const { data: eq } = await admin.from('equipment').select('next_due_date, last_inspection_date').eq('id', pro.equipmentId).single();
  expect(eq.last_inspection_date).toBeTruthy();
  expect(eq.next_due_date > '2026-01-01').toBe(true);

  const { data: p } = await admin.from('profiles').select('esign_consent, esign_consent_version').eq('id', tech.profileId).single();
  expect(p.esign_consent).toBe(true);
  expect(p.esign_consent_version).toBeTruthy();

  // Both evidence files really are in the private bucket.
  for (const path of [row.photo_url, row.signature_url]) {
    const { error } = await admin.storage.from('evidence').download(path);
    expect(error, `evidence ${path}`).toBeNull();
  }
  // The technician sees what they filed on the dashboard (rows render, not stuck mid-animation).
  await page.goto('/app/dashboard');
  await expect(page.getByRole('cell', { name: 'Stair extinguisher pro' }).first()).toBeVisible();
  expect(csp, 'CSP violations during a signed submission').toEqual([]);
  await ctx.close();
});

test('a failed checklist item leads to a corrective action', async ({ browser }) => {
  const tech = pro.members[0];
  const ctx = await prodContext(browser);
  const page = await ctx.newPage();
  await signIn(page, tech);

  await fillInspection(page, { fail: true });
  await page.getByRole('button', { name: /Sign & Submit Inspection/ }).click();

  // The technician must be able to describe what is wrong and how severe it is.
  const dialog = page.getByRole('dialog', { name: 'Report Issue' });
  await expect(dialog, 'corrective action form after a failed item').toBeVisible();
  await dialog.getByPlaceholder('Describe the issue found...').fill(`Pressure gauge reads empty ${RUN}`);
  await dialog.getByRole('button', { name: 'Major', exact: true }).click();
  await dialog.getByRole('button', { name: 'Submit Corrective Action' }).click();
  await expect(page.getByText('Corrective action submitted')).toBeVisible();

  const { data: actions } = await admin
    .from('corrective_actions')
    .select('description, severity, inspection_id')
    .eq('organization_id', pro.orgId);
  expect(actions).toHaveLength(1);
  expect(actions[0].severity).toBe('major');
  const { data: insp } = await admin.from('inspections').select('status').eq('id', actions[0].inspection_id).single();
  expect(insp.status).toBe('Action Required');
  await ctx.close();
});

test('the free plan files an unsigned inspection and says why', async ({ browser }) => {
  const free = await organisation('free', 'free', 0);
  const ctx = await prodContext(browser);
  const page = await ctx.newPage();
  await signIn(page, free.owner);

  await fillInspection(page, { sign: false });
  await expect(page.getByText(/Electronic signatures are part of the Pro plan/)).toBeVisible();
  await page.getByRole('button', { name: 'Submit Inspection' }).click();
  await expect(page.getByRole('heading', { name: 'Inspection Complete!' })).toBeVisible();

  const { data } = await admin.from('inspections').select('signature_url').eq('organization_id', free.orgId);
  expect(data).toEqual([{ signature_url: null }]);
  await ctx.close();
});

test('offline: a signed inspection is queued, then synced when the connection returns', async ({ browser }) => {
  const tech = pro.members[1];
  const ctx = await prodContext(browser);
  const page = await ctx.newPage();
  await signIn(page, tech);
  const before = (await admin.from('inspections').select('id', { count: 'exact', head: true }).eq('inspector_id', tech.profileId)).count;

  await fillInspection(page);
  await ctx.setOffline(true);
  await page.getByRole('button', { name: /Sign & Submit Inspection/ }).click();
  await expect(page.getByText(/Saved offline/)).toBeVisible();
  await ctx.setOffline(false);

  await expect
    .poll(async () => (await admin.from('inspections').select('id', { count: 'exact', head: true }).eq('inspector_id', tech.profileId)).count, { timeout: 30_000 })
    .toBe(before + 1);
  const { data } = await admin
    .from('inspections')
    .select('signature_url, photo_url')
    .eq('inspector_id', tech.profileId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  expect(data.signature_url).toBeTruthy();
  expect(data.photo_url).toBeTruthy();
  await ctx.close();
});

test('offline: another person’s queued signed inspection is held, not filed under the new user', async ({ browser }) => {
  const [first, second] = pro.members;
  const ctx = await prodContext(browser);
  const page = await ctx.newPage();
  await signIn(page, first);
  const firstBefore = (await admin.from('inspections').select('id', { count: 'exact', head: true }).eq('inspector_id', first.profileId)).count;

  await fillInspection(page);
  await ctx.setOffline(true);
  await page.getByRole('button', { name: /Sign & Submit Inspection/ }).click();
  await expect(page.getByText(/Saved offline/)).toBeVisible();

  // Shared device: the first technician leaves without reconnecting; the second signs in.
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('sb-')) localStorage.removeItem(k);
  });
  await ctx.setOffline(false);
  await signIn(page, second);
  // Sent automatically on sign-in — and held, because it is not theirs to file.
  await expect(page.getByText(/waiting for the person who signed to sign in/i).first()).toBeVisible({ timeout: 20_000 });

  const secondCount = (await admin.from('inspections').select('id', { count: 'exact', head: true }).eq('inspector_id', second.profileId)).count;
  const firstAfter = (await admin.from('inspections').select('id', { count: 'exact', head: true }).eq('inspector_id', first.profileId)).count;
  expect(firstAfter, 'nothing filed for the first technician while they are signed out').toBe(firstBefore);
  expect(secondCount, 'nothing filed under the second technician').toBe(1); // their earlier online one

  // The signer comes back to this device: their held inspection is filed automatically.
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('sb-')) localStorage.removeItem(k);
  });
  await signIn(page, first);
  await expect
    .poll(async () => (await admin.from('inspections').select('id', { count: 'exact', head: true }).eq('inspector_id', first.profileId)).count, { timeout: 30_000 })
    .toBe(firstBefore + 1);
  await ctx.close();
});

test('an admin adds equipment and sees it listed', async ({ browser }) => {
  const ctx = await prodContext(browser);
  const page = await ctx.newPage();
  await signIn(page, pro.owner);
  await page.goto('/app/equipment');
  await page.getByRole('button', { name: /add equipment/i }).click();
  await page.getByPlaceholder('Equipment Name *').fill(`Lobby extinguisher ${RUN}`);
  await page.getByPlaceholder('Type (e.g., Excavator)').fill('Fire Extinguisher');
  await page.getByPlaceholder('Serial Number').fill(`SN-${RUN}`);
  await page.getByPlaceholder('Location').fill('Lobby');
  await page.locator('form button[type="submit"]').click();
  await expect(page.getByText(`Lobby extinguisher ${RUN}`)).toBeVisible();
  const { data } = await admin.from('equipment').select('name').eq('organization_id', pro.orgId);
  expect(data.map((e) => e.name)).toContain(`Lobby extinguisher ${RUN}`);
  await ctx.close();
});

test('an admin can remove a technician who has signed inspections; the records stay', async ({ browser }) => {
  const tech = pro.members[0];
  const ctx = await prodContext(browser);
  const page = await ctx.newPage();
  await signIn(page, pro.owner);
  await page.goto('/app/team');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: `Remove ${'Tech0 pro'}` }).click();
  await expect(page.getByRole('button', { name: `Remove ${'Tech0 pro'}` })).toHaveCount(0, { timeout: 15_000 });

  const { data: signed } = await admin
    .from('inspections')
    .select('inspector_name, signature_url')
    .eq('organization_id', pro.orgId)
    .not('signature_url', 'is', null)
    .eq('inspector_name', 'Tech0 pro');
  expect(signed.length, 'the removed technician’s signed records are still on file under their name').toBeGreaterThan(0);
  await ctx.close();
});
