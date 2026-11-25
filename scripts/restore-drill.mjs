#!/usr/bin/env node
/**
 * Restore drill (Rule 23: "test consistent backups ... isolated restores, achieved RPO/RTO").
 *
 *   node tests/with_db_password.mjs drill:restore
 *
 * What it proves: the LIVE database's data can be dumped and restored into a database rebuilt
 * from nothing but this repository's migrations, with every row accounted for. That is the
 * free-tier recovery path — the Supabase free plan has no point-in-time recovery, so a logical
 * dump plus the migrations IS the backup.
 *
 * Steps, each timed:
 *   1. pg_dump (via the Supabase CLI) of the live public + auth data. Read-only on live.
 *   2. `supabase db reset --local` — the schema from supabase/migrations/ only. WIPES the LOCAL
 *      stack (never the live one: --local is a hard-coded flag, not an argument).
 *   3. psql restore of the dump into the local database.
 *   4. Row counts per public table: live (service role, REST) vs restored (psql).
 *
 * Limits: storage OBJECTS (photos, signatures) are files, not rows, and are not in a pg_dump —
 * the restore brings back their database records and paths only. The dump holds personal data
 * (auth emails), so it is written to the OS temp directory and deleted in `finally`.
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { ROOT, exitWith, loadEnvLocal, requireEnv, supabaseProjectRef } from './lib/ops-env.mjs';

loadEnvLocal();
requireEnv('SUPABASE_DB_PASSWORD', 'The dump connects to the live database. Run via tests/with_db_password.mjs.');
const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL', 'Live row counts are read through the API.');
const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY', 'Live row counts must see every tenant.');
const ref = supabaseProjectRef({ fromLinkFile: true }) ?? exitWith('No project ref.');

const projectId = /^project_id\s*=\s*"([a-z0-9_-]+)"/m.exec(readFileSync(join(ROOT, 'supabase/config.toml'), 'utf8'))?.[1];
if (!projectId) exitWith('No project_id in supabase/config.toml.');
const container = `supabase_db_${projectId}`;

const sh = (cmd, opts = {}) => execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...opts });
const timed = (label, fn) => {
  const t = Date.now();
  const out = fn();
  const s = (Date.now() - t) / 1000;
  console.log(`  ${label}: ${s.toFixed(1)} s`);
  return { out, s };
};

// From auth, only the accounts themselves are restored: users and identities. Sessions, refresh
// tokens, one-time tokens and MFA challenges are live credentials — a restore must make everyone
// sign in again, not resurrect their sessions. An allow-list rather than a deny-list, because the
// hosted Auth version adds tables the CLI's local image does not have.
const AUTH_RESTORED = new Set(['users', 'identities']);

/** Keep every public COPY block and the allow-listed auth ones; drop every other auth block. */
function filterDump(sql) {
  const out = [];
  let skipping = false;
  for (const line of sql.split(/\r?\n/)) {
    const copy = /^COPY "?auth"?\."?([a-z_]+)"?/.exec(line);
    if (copy) skipping = !AUTH_RESTORED.has(copy[1]);
    if (!skipping) out.push(line);
    // A COPY block ends with a line holding only backslash-dot.
    if (skipping && line === '\\.') skipping = false;
  }
  return out.join('\n');
}

const dir = mkdtempSync(join(tmpdir(), 'equipcert-drill-'));
const dump = join(dir, 'data.sql');
let failed = false;
try {
  console.log(`Restore drill — live ${ref} → local ${container}\n`);
  const t0 = Date.now();

  const d = timed('1. dump live data (public, auth)', () =>
    sh(`npx --silent supabase db dump --linked --project-ref ${ref} --data-only --use-copy -s public,auth -f "${dump}" --agent no`)
  );
  console.log(`     ${(statSync(dump).size / 1024).toFixed(0)} KiB`);

  const r = timed('2. rebuild local schema from migrations', () => sh('npx --silent supabase db reset --local --no-seed --agent no'));

  const tables = sh(
    `docker exec ${container} psql -U postgres -d postgres -At -c "select tablename from pg_tables where schemaname='public' order by 1"`
  )
    .trim()
    .split(/\r?\n/)
    .filter((t) => /^[a-z_]+$/.test(t));

  // Reference rows the migrations seed (plan_limits) are replaced by live's values, which is what
  // a restore must bring back. Replica mode skips triggers and FK checks for the bulk load, as
  // pg_dump intends; RLS does not apply to the postgres superuser.
  const header = `SET session_replication_role = replica;\nTRUNCATE ${tables.map((t) => `public.${t}`).join(', ')} CASCADE;\n`;
  const restoreSql = header + filterDump(readFileSync(dump, 'utf8'));
  // Table names only — never row data, which includes personal data.
  const restoring = [...restoreSql.matchAll(/^COPY "?([a-z_]+)"?\."?([a-z_]+)"?/gm)].map((m) => `${m[1]}.${m[2]}`);
  console.log(`     restoring ${restoring.length} tables: ${restoring.join(', ')}`);
  const p = timed('3. restore into local', () =>
    sh(`docker exec -i ${container} psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q`, { input: restoreSql })
  );

  const live = createClient(url, serviceKey, { auth: { persistSession: false } });
  console.log('\n  4. row counts (live → restored)');
  for (const t of tables) {
    const { count, error } = await live.from(t).select('*', { count: 'exact', head: true });
    const restored = Number(sh(`docker exec ${container} psql -U postgres -d postgres -At -c "select count(*) from public.${t}"`).trim());
    if (error || count === null) {
      // A table that exists only in a migration not yet applied live (new this release).
      console.log(`     ${t.padEnd(28)} live: not present (${error?.code ?? "no such table"}) → ${restored}`);
      continue;
    }
    const ok = count === restored;
    if (!ok) failed = true;
    console.log(`     ${ok ? '✓' : '✗'} ${t.padEnd(26)} ${count} → ${restored}`);
  }
  const users = Number(sh(`docker exec ${container} psql -U postgres -d postgres -At -c "select count(*) from auth.users"`).trim());
  console.log(`     auth.users restored: ${users}`);

  const total = (Date.now() - t0) / 1000;
  console.log(`\nRTO (dump + rebuild + restore, this machine): ${(d.s + r.s + p.s).toFixed(1)} s; whole drill ${total.toFixed(1)} s`);
  console.log(failed ? '✗ Row counts differ — the restore is NOT complete.' : '✓ Every live row is present after the restore.');
} catch (error) {
  failed = true;
  const msg = String(error.stderr || error.message || error).split('\n').slice(0, 6).join('\n');
  console.error(`✗ Drill failed:\n${msg}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
  // The restored copy holds live personal data (account emails). It must not outlive the drill in
  // a development database (Rule 23: no production data in lower environments).
  try {
    sh('npx --silent supabase db reset --local --no-seed --agent no');
    console.log('  local database wiped (live copy removed)');
  } catch {
    failed = true;
    console.error('✗ Could not wipe the local database — run `npx supabase db reset --local` now.');
  }
}
process.exit(failed ? 1 : 0);
