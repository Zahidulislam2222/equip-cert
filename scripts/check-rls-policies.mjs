#!/usr/bin/env node
/**
 * Assert the LIVE database's authorization posture. Not the migrations — the database.
 *
 * WHY THIS EXISTS
 *
 * DEF-027 is the whole argument. The repository contained an eleven-table, RLS-enforced,
 * tenant-scoped schema. The database the application actually authenticated against was a
 * single table with `relrowsecurity = false` and two public storage buckets. Every gate was
 * green, because every gate read the repository. "The schema is in the repo" and "the schema
 * is in the database" are different claims and only one of them protects a user.
 *
 * Three properties are checked, chosen because each has already failed somewhere real:
 *
 *   1. RLS enabled on every table in `public`.
 *      A table without RLS is not weakly protected, it is unprotected.
 *
 *   2. Every policy names a role. A policy written without `TO <role>` applies to PUBLIC,
 *      which includes `anon` — an unauthenticated request. This is the single highest-value
 *      thing to audit in a Supabase schema and it is invisible when reading a policy quickly,
 *      because the policy still *looks* restrictive.
 *
 *   3. Every UPDATE policy carries WITH CHECK. USING decides which rows a caller may update;
 *      WITH CHECK decides what they may write into them. A policy with USING alone lets a
 *      caller edit a row they legitimately see into a state they should never be able to set.
 *      DEF-020 was exactly that shape: a technician could PATCH their own profile row and set
 *      role to admin, because RLS decides rows, never columns.
 *
 * Usage:  npm run test:rls-policies
 *
 * Needs SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF (or a linked project). Read-only: it
 * runs SELECTs against catalog views and writes nothing.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANAGEMENT_API = 'https://api.supabase.com';

// Load .env.local the same way the e2e suite does, so a developer runs one command and it
// works. CI supplies the same names as secrets.
const envPath = join(ROOT, '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`✗ ${name} is not set.`);
    console.error('  This gate reads live database state and cannot be faked offline.');
    process.exit(1);
  }
  return value;
}

const TOKEN = required('SUPABASE_ACCESS_TOKEN');
const REF =
  process.env.SUPABASE_PROJECT_REF ||
  (existsSync(join(ROOT, 'supabase/.temp/project-ref'))
    ? readFileSync(join(ROOT, 'supabase/.temp/project-ref'), 'utf8').trim()
    : null);

if (!REF) {
  console.error('✗ No project ref. Set SUPABASE_PROJECT_REF or run `supabase link`.');
  process.exit(1);
}

async function query(sql) {
  const res = await fetch(`${MANAGEMENT_API}/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    console.error(`✗ Query failed: HTTP ${res.status}`);
    console.error(`  ${(await res.text()).slice(0, 300)}`);
    process.exit(1);
  }
  return res.json();
}

const failures = [];

// --- 1. RLS enabled on every public table -----------------------------------------------
const tables = await query(`
  SELECT c.relname AS table_name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  ORDER BY c.relname;
`);

for (const t of tables) {
  if (!t.rls) failures.push(`RLS DISABLED on public.${t.table_name}`);
}

// --- 2. Every policy names a role -------------------------------------------------------
// `roles` is a name[]; a policy with no TO clause stores {public}.
const policies = await query(`
  SELECT schemaname, tablename, policyname, cmd, roles::text AS roles,
         qual IS NOT NULL AS has_using,
         with_check IS NOT NULL AS has_with_check
  FROM pg_policies
  WHERE schemaname = 'public'
  ORDER BY tablename, policyname;
`);

for (const p of policies) {
  if (/\{public\}/.test(p.roles)) {
    failures.push(
      `POLICY APPLIES TO PUBLIC (includes anon): ${p.tablename}.${p.policyname}`,
    );
  }
  // --- 3. UPDATE policies must constrain what can be written --------------------------
  if ((p.cmd === 'UPDATE' || p.cmd === 'ALL') && !p.has_with_check) {
    failures.push(
      `UPDATE POLICY WITHOUT WITH CHECK: ${p.tablename}.${p.policyname} (${p.cmd})`,
    );
  }
}

// --- Report ------------------------------------------------------------------------------
const forced = tables.filter((t) => t.forced).length;
console.log(
  `  ${tables.length} tables in public · RLS enabled on ${tables.filter((t) => t.rls).length} · FORCED on ${forced}`,
);
console.log(`  ${policies.length} policies · all checked for role scope and write constraints`);

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} authorization problem(s) in the LIVE database:\n`);
  for (const f of failures) console.error(`   ${f}`);
  process.exit(1);
}

console.log('✓ Live authorization posture intact — RLS on, no PUBLIC policies, UPDATEs constrained.');
