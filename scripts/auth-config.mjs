#!/usr/bin/env node
/**
 * Reconcile the LIVE Supabase Auth configuration against supabase/auth-baseline.json.
 *
 * WHY THIS EXISTS
 *
 * Authentication settings are the highest-consequence configuration in the product and the
 * only configuration that lives entirely outside the repository. Nothing in a code review
 * shows you that magic-link tokens are valid for an hour, that the production redirect URL is
 * not in the allow list, or that every account-takeover notification email is switched off.
 * All three were true here, and every gate was green.
 *
 * DEF-027 was the same failure one layer down: the repository described an eleven-table
 * RLS-enforced schema while the live database had one unprotected table. The lesson generalises
 * — assert the running system, not the file that describes it.
 *
 *   npm run test:auth-config     read-only. Exits non-zero on any drift. Safe in CI.
 *   node scripts/auth-config.mjs --apply
 *                                writes the `settings` block. Never writes `assert_only`.
 *
 * Read path needs SUPABASE_ACCESS_TOKEN with project read; --apply needs write.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ROOT,
  SUPABASE_MANAGEMENT_API as MANAGEMENT_API,
  exitWith,
  loadEnvLocal,
  requireEnv,
  supabaseProjectRef,
} from './lib/ops-env.mjs';

const APPLY = process.argv.includes('--apply');

// Same .env.local loading as the other live gates, so one command works for a developer and
// the identical variable names work as CI secrets.
loadEnvLocal();

const TOKEN = requireEnv(
  'SUPABASE_ACCESS_TOKEN',
  'This gate reads live project state and cannot be satisfied offline.'
);
const REF =
  supabaseProjectRef({ fromLinkFile: true }) ??
  exitWith('No project ref. Set SUPABASE_PROJECT_REF or run `supabase link`.');

const baseline = JSON.parse(readFileSync(join(ROOT, 'supabase/auth-baseline.json'), 'utf8'));

async function authConfig(method, body) {
  const res = await fetch(`${MANAGEMENT_API}/v1/projects/${REF}/config/auth`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 400);
    console.error(`✗ ${method} /config/auth failed: HTTP ${res.status}`);
    console.error(`  ${text}`);
    process.exit(1);
  }
  return res.json();
}

/** Comparable form. The API returns numbers as numbers and blanks as "" or null. */
const norm = (v) => (v === null || v === undefined ? '' : typeof v === 'boolean' ? v : String(v));
const show = (v) => (norm(v) === '' ? '(empty)' : String(v));

const live = await authConfig('GET');

// --- Apply ------------------------------------------------------------------------------
if (APPLY) {
  const patch = {};
  for (const [key, spec] of Object.entries(baseline.settings)) {
    if (norm(live[key]) !== norm(spec.value)) patch[key] = spec.value;
  }

  if (Object.keys(patch).length === 0) {
    console.log('  Live auth configuration already matches the baseline. Nothing to write.');
  } else {
    console.log(`  Writing ${Object.keys(patch).length} setting(s):\n`);
    for (const key of Object.keys(patch)) {
      console.log(`    ${key}`);
      console.log(`      ${show(live[key])}  ->  ${show(patch[key])}`);
    }
    // One PATCH, not one per key: a partial application would leave the project in a posture
    // that matches neither the old state nor the baseline, and nothing would say which.
    await authConfig('PATCH', patch);
    console.log('\n  Applied. Re-reading to confirm the server accepted each value.\n');
  }
}

// --- Verify (always, including immediately after --apply) --------------------------------
const after = APPLY ? await authConfig('GET') : live;
const drift = [];

for (const [key, spec] of Object.entries(baseline.settings)) {
  if (norm(after[key]) !== norm(spec.value)) {
    drift.push({ key, want: spec.value, got: after[key], enforced: true });
  }
}
for (const [key, spec] of Object.entries(baseline.assert_only)) {
  if (key === '$comment') continue;
  if (norm(after[key]) !== norm(spec.value)) {
    drift.push({ key, want: spec.value, got: after[key], enforced: false });
  }
}

const managed = Object.keys(baseline.settings).length;
const asserted = Object.keys(baseline.assert_only).length - 1;
console.log(
  `  project ${REF} · ${managed} managed setting(s) · ${asserted} assertion(s) · ${
    Object.keys(baseline.known_gaps).length - 1
  } recorded gap(s)`,
);

if (drift.length > 0) {
  console.error(`\n✗ ${drift.length} auth setting(s) do not match the baseline:\n`);
  for (const d of drift) {
    console.error(`   ${d.key}`);
    console.error(`     live     ${show(d.got)}`);
    console.error(`     baseline ${show(d.want)}`);
    console.error(
      `     ${
        d.enforced
          ? 'Run `node scripts/auth-config.mjs --apply` to reconcile.'
          : 'ASSERT-ONLY — this changed outside the repository. Investigate before reconciling.'
      }\n`,
    );
  }
  process.exit(1);
}

console.log('✓ Live auth configuration matches supabase/auth-baseline.json.');
for (const [key, note] of Object.entries(baseline.known_gaps)) {
  if (key === '$comment') continue;
  console.log(`  ◦ gap: ${key} — ${note.split('.')[0]}.`);
}
