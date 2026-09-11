#!/usr/bin/env node
/**
 * Fail when a migration exists in the repository but has never been applied to the project,
 * or when the project has one the repository does not.
 *
 * WHY THIS EXISTS
 *
 * A migration that has been written, reviewed and merged still does nothing until it runs.
 * The gap between "merged" and "applied" is invisible to every other gate: the build passes,
 * the types may even pass if they were generated before the migration landed, and the failure
 * surfaces later as a column that does not exist — in production, at runtime, to a user.
 *
 * The reverse direction matters just as much. A migration applied to the project but absent
 * from the repository means someone changed the schema by hand, which is precisely how
 * DEF-019 happened: the `inspections` table lived only in a dashboard, was never captured in
 * source, and its definition was lost when the project was paused and forgotten.
 *
 * Usage:  npm run test:migrations
 *
 * Requires either a locally linked project (`supabase link`) or SUPABASE_PROJECT_REF.
 *
 * CI has no link step on purpose (DEF-053): `supabase link` calls `GET /v1/projects/{ref}`,
 * which the Management API refuses for a scoped access token. `--linked --project-ref <ref>`
 * needs no link file and no refused call, so the ref is passed explicitly whenever it is set.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(exec);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Validated before interpolation for the same reason as in check-generated-types.mjs: `exec`
// goes through a shell because `npx` is a .cmd shim on Windows, so the only value that reaches
// the command line must be provably a project ref and nothing else.
const ref = process.env.SUPABASE_PROJECT_REF;
if (ref && !/^[a-z]{20}$/.test(ref)) {
  console.error(`✗ SUPABASE_PROJECT_REF is not a valid project ref: ${ref}`);
  process.exit(1);
}
const target = ref ? `--linked --project-ref ${ref}` : '--linked';

let raw;
try {
  const { stdout } = await run(`npx --silent supabase migration list ${target}`, {
    cwd: ROOT,
    maxBuffer: 8 * 1024 * 1024,
  });
  raw = stdout;
} catch (error) {
  console.error('✗ Could not list migrations.');
  console.error('  This gate needs either SUPABASE_PROJECT_REF + SUPABASE_DB_PASSWORD, or a');
  console.error('  local `supabase link`. It does NOT need a link step in CI — see DEF-053.');
  console.error(`  ${error.stderr?.trim() || error.message}`);
  process.exit(1);
}

// The CLI prints a human line before the JSON payload, so take the last JSON object.
const match = raw.match(/\{[\s\S]*\}\s*$/);
if (!match) {
  console.error('✗ Could not parse the migration list output.');
  console.error(raw.slice(0, 800));
  process.exit(1);
}

const { migrations = [] } = JSON.parse(match[0]);

const unapplied = migrations.filter((m) => m.local && !m.remote);
const untracked = migrations.filter((m) => m.remote && !m.local);

for (const m of migrations) {
  const state = !m.remote ? 'NOT APPLIED' : !m.local ? 'NOT IN REPO' : 'ok';
  console.log(`  ${(m.local || m.remote).padEnd(16)} ${state}`);
}

if (unapplied.length === 0 && untracked.length === 0) {
  console.log(`✓ All ${migrations.length} migrations are applied and tracked.`);
  process.exit(0);
}

if (unapplied.length > 0) {
  console.error(
    `\n✗ ${unapplied.length} migration(s) in the repository have never been applied:\n` +
    unapplied.map((m) => `    ${m.local}`).join('\n') +
    '\n  The code that depends on them will fail at runtime, not at build time.' +
    '\n  Run: npx supabase db push'
  );
}

if (untracked.length > 0) {
  console.error(
    `\n✗ ${untracked.length} migration(s) are applied to the project but absent from the repository:\n` +
    untracked.map((m) => `    ${m.remote}`).join('\n') +
    '\n  The schema was changed outside source control. Capture it before it is lost —' +
    '\n  that is exactly how the inspections table went missing (DEF-019).' +
    '\n  Run: npx supabase db pull'
  );
}

process.exit(1);
