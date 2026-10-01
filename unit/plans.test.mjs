// Unit tests for plan gating (src/lib/plans.ts).
//
// `canAccess` decides which features an organisation's plan unlocks in the UI. The database
// enforces the hard limits (plan_limits + RLS); this is the client's half, and an unknown or
// tampered plan string must unlock nothing that is gated.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let plans;
let workDir;

before(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'equipcert-unit-'));
  const outFile = join(workDir, 'plans.mjs');
  buildSync({
    entryPoints: ['src/lib/plans.ts'],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'warning',
    outfile: outFile,
  });
  plans = await import(pathToFileURL(outFile).href);
});

after(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

const GATED = ['corrective_actions', 'signatures', 'scheduling', 'team', 'reports'];

describe('canAccess', () => {
  test('free unlocks none of the gated features', () => {
    for (const f of [...GATED, 'api']) assert.equal(plans.canAccess('free', f), false, f);
  });

  test('pro unlocks every gated feature except the API', () => {
    for (const f of GATED) assert.equal(plans.canAccess('pro', f), true, f);
    assert.equal(plans.canAccess('pro', 'api'), false);
  });

  test('enterprise unlocks everything', () => {
    for (const f of [...GATED, 'api']) assert.equal(plans.canAccess('enterprise', f), true, f);
  });

  test('an unknown or tampered plan string unlocks nothing gated', () => {
    for (const plan of ['', 'PRO', 'pro ', 'admin', 'enterprise\u0000', '__proto__']) {
      for (const f of [...GATED, 'api']) {
        assert.equal(plans.canAccess(plan, f), false, `${JSON.stringify(plan)} → ${f}`);
      }
    }
  });
});

describe('plan data', () => {
  test('PLAN_ORDER names exactly the defined plans', () => {
    assert.deepEqual([...plans.PLAN_ORDER].sort(), Object.keys(plans.PLANS).sort());
  });

  test('formatPlanPrice is derived from PLANS, never restated', () => {
    for (const id of plans.PLAN_ORDER) {
      assert.equal(plans.formatPlanPrice(id), `${plans.CURRENCY_SYMBOL}${plans.PLANS[id].price}`);
    }
  });
});
