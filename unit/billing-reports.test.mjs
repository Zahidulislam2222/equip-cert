// Unit tests for the pure billing rules (src/lib/billing.ts) and report aggregation / CSV export
// (src/lib/reports.ts). Both decide things that are expensive to get wrong: which plan a payment
// buys, and what a compliance report says.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let billing;
let reports;
let workDir;

before(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'equipcert-unit-'));
  for (const [name, entry] of [['billing', 'src/lib/billing.ts'], ['reports', 'src/lib/reports.ts']]) {
    const outfile = join(workDir, `${name}.mjs`);
    buildSync({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'neutral', logLevel: 'warning', outfile });
    if (name === 'billing') billing = await import(pathToFileURL(outfile).href);
    else reports = await import(pathToFileURL(outfile).href);
  }
});

after(() => rmSync(workDir, { recursive: true, force: true }));

const sub = (status, lookup_key) => ({ status, items: { data: [{ price: { lookup_key } }] } });

describe('billing: which plan a subscription buys', () => {
  test('lookup keys round-trip and reject other projects', () => {
    assert.equal(billing.lookupKeyFor('equipcert', 'pro'), 'equipcert_pro_monthly');
    assert.equal(billing.planFromLookupKey('equipcert', 'equipcert_pro_monthly'), 'pro');
    assert.equal(billing.planFromLookupKey('equipcert', 'adrevora_pro_monthly'), null, 'shared account: other prefix');
    assert.equal(billing.planFromLookupKey('equipcert', 'equipcert_platinum_monthly'), null, 'unknown plan');
    assert.equal(billing.planFromLookupKey('equipcert', null), null);
  });

  test('active / trialing / past_due keep the paid plan; everything else is free', () => {
    for (const s of ['active', 'trialing', 'past_due']) assert.equal(billing.planFromSubscription('equipcert', sub(s, 'equipcert_pro_monthly')), 'pro');
    for (const s of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'])
      assert.equal(billing.planFromSubscription('equipcert', sub(s, 'equipcert_pro_monthly')), 'free');
    assert.equal(billing.planFromSubscription('equipcert', null), 'free');
  });

  test('a paid subscription to an unrecognised price grants nothing', () => {
    assert.equal(billing.planFromSubscription('equipcert', sub('active', 'someone_elses_price')), 'free');
  });

  test('organisation ids from webhook metadata must be UUIDs', () => {
    assert.equal(billing.asOrganizationId('0f8fad5b-d9cb-469f-a165-70867728950e'), '0f8fad5b-d9cb-469f-a165-70867728950e');
    for (const bad of ["1' OR '1'='1", '', null, 42, 'not-a-uuid']) assert.equal(billing.asOrganizationId(bad), null);
  });

  test('only configured, real, non-free plans are self-serve', () => {
    assert.equal(billing.isSelfServePlan(['pro'], 'pro'), true);
    assert.equal(billing.isSelfServePlan(['pro'], 'enterprise'), false, 'not configured');
    assert.equal(billing.isSelfServePlan(['pro', 'free'], 'free'), false, 'free is never bought');
    assert.equal(billing.isSelfServePlan(['ghost'], 'ghost'), false, 'not a real plan');
    assert.equal(billing.isSelfServePlan(['pro'], '__proto__'), false);
  });

  test('a live Stripe key is refused unless explicitly allowed (Rule 5)', () => {
    assert.equal(billing.stripeKeyAllowed('sk_test_abc', false), true);
    assert.equal(billing.stripeKeyAllowed('sk_live_abc', false), false);
    assert.equal(billing.stripeKeyAllowed('sk_live_abc', true), true);
    assert.equal(billing.stripeKeyAllowed('garbage', true), false);
  });
});

const insp = (id, created_at, status, extra = {}) => ({
  id,
  created_at,
  status,
  equipment_name: 'Extinguisher A',
  inspector_name: 'Dana',
  ai_assisted: false,
  signature_url: 'org/sig.png',
  ...extra,
});

describe('reports: aggregation', () => {
  test('counts, pass rate, and percentages', () => {
    const s = reports.summarize(
      [
        insp(1, '2026-11-02T10:00:00Z', 'Safe'),
        insp(2, '2026-11-03T10:00:00Z', 'Action Required', { ai_assisted: true }),
        insp(3, '2026-11-10T10:00:00Z', 'Safe', { signature_url: null, inspector_name: 'Lee' }),
        insp(4, '2026-11-11T10:00:00Z', 'Safe'),
      ],
      [
        { status: 'open', severity: 'critical', due_date: '2026-11-01' },
        { status: 'in_progress', severity: 'minor', due_date: '2026-12-31' },
        { status: 'resolved', severity: 'major', due_date: '2026-11-01' },
        { status: 'overdue', severity: 'major', due_date: null },
      ],
      [
        { status: 'active', next_due_date: '2026-11-20' },
        { status: 'active', next_due_date: '2026-12-20' },
        { status: 'retired', next_due_date: '2026-01-01' },
      ],
      '2026-11-25'
    );
    assert.equal(s.total, 4);
    assert.equal(s.actionRequired, 1);
    assert.equal(s.passRate, 75);
    assert.equal(s.signedPct, 75);
    assert.equal(s.aiAssistedPct, 25);
    assert.deepEqual(s.openActions, { critical: 1, major: 1, minor: 1 }, 'resolved excluded');
    assert.equal(s.overdueActions, 2, 'past due date OR status overdue');
    assert.equal(s.overdueEquipment, 1, 'retired equipment is never overdue');
    assert.deepEqual(s.byWeek.map((w) => w.weekStart), ['2026-11-02', '2026-11-09']);
    assert.deepEqual(s.byInspector[0], { name: 'Dana', total: 3, actionRequired: 1 });
  });

  test('no inspections → null rates, not 0% or NaN', () => {
    const s = reports.summarize([], [], [], '2026-11-25');
    assert.equal(s.passRate, null);
    assert.equal(s.signedPct, null);
  });

  test('weeks start on Monday (UTC)', () => {
    assert.equal(reports.weekStart('2026-11-29T23:59:00Z'), '2026-11-23'); // Sunday
    assert.equal(reports.weekStart('2026-11-23T00:00:00Z'), '2026-11-23'); // Monday
  });
});

describe('reports: CSV export is not a formula-injection vector', () => {
  test('cells a spreadsheet would evaluate are neutralised', () => {
    for (const evil of ['=HYPERLINK("http://x","y")', '+1+1', '-2+3', '@SUM(A1)', '\tx', '\rx']) {
      assert.ok(reports.csvCell(evil).startsWith(`"'`), `${JSON.stringify(evil)} must be prefixed`);
    }
    assert.equal(reports.csvCell('plain'), '"plain"');
    assert.equal(reports.csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(reports.csvCell(null), '""');
  });

  test('export has a BOM, a header, CRLF rows and every inspection', () => {
    const csv = reports.inspectionsToCsv([insp(7, '2026-11-02T10:00:00Z', 'Safe', { equipment_name: '=cmd' })]);
    assert.ok(csv.startsWith('﻿"Inspection ID"'));
    const lines = csv.slice(1).trimEnd().split('\r\n');
    assert.equal(lines.length, 2);
    assert.match(lines[1], /"'=cmd"/);
  });
});

describe('plan from the whole subscription set (review 2026-11-25)', () => {
  const s = (id, status, lookup_key, created) => ({ id, status, created, items: { data: [{ price: { lookup_key } }] } });

  test('a cancelled old subscription does not downgrade a still-paying organisation', () => {
    const r = billing.pickPaidSubscription('equipcert', [
      s('sub_old', 'canceled', 'equipcert_pro_monthly', 100),
      s('sub_new', 'active', 'equipcert_pro_monthly', 200),
    ]);
    assert.equal(r.plan, 'pro');
    assert.equal(r.subscription.id, 'sub_new');
    assert.equal(r.paidCount, 1);
  });

  test('two paid subscriptions: the higher plan governs, and the duplicate is counted', () => {
    const r = billing.pickPaidSubscription('equipcert', [
      s('sub_pro', 'active', 'equipcert_pro_monthly', 300),
      s('sub_ent', 'past_due', 'equipcert_enterprise_monthly', 100),
    ]);
    assert.equal(r.plan, 'enterprise');
    assert.equal(r.subscription.id, 'sub_ent');
    assert.equal(r.paidCount, 2);
  });

  test('same plan twice: the newest governs', () => {
    const r = billing.pickPaidSubscription('equipcert', [
      s('a', 'active', 'equipcert_pro_monthly', 100),
      s('b', 'active', 'equipcert_pro_monthly', 200),
    ]);
    assert.equal(r.subscription.id, 'b');
  });

  test('nothing paid, or another project\'s price: free, no subscription', () => {
    for (const subs of [[], [s('x', 'canceled', 'equipcert_pro_monthly', 1)], [s('y', 'active', 'adrevora_pro_monthly', 1)]]) {
      const r = billing.pickPaidSubscription('equipcert', subs);
      assert.equal(r.plan, 'free');
      assert.equal(r.subscription, null);
    }
  });

  test('seats are the member count, never below one', () => {
    assert.equal(billing.seatQuantity(7), 7);
    assert.equal(billing.seatQuantity(0), 1);
    assert.equal(billing.seatQuantity(null), 1);
  });

  test('the renewal backstop event is handled', () => {
    assert.ok(billing.HANDLED_EVENTS.has('invoice.upcoming'));
  });
});
