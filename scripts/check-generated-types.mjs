#!/usr/bin/env node
/**
 * Fail when src/lib/database.types.ts no longer matches the applied migrations.
 *
 * WHY THIS EXISTS
 *
 * A generated file that nothing verifies is a copy, and copies drift. That is DEF-021 exactly:
 * the free-plan limit lived in plans.ts AND as a literal in SQL, and nothing compared them.
 * The generated database types are the same hazard with a larger blast radius — if they fall
 * behind a migration, TypeScript starts confidently checking the application against a schema
 * that no longer exists, which is worse than not checking at all.
 *
 * Regenerating on every build is not an option: it needs network access and a linked project,
 * and a build should not fail on a train. So this is a separate gate, run in CI and before a
 * deploy, alongside `npm run test:deps`.
 *
 * Usage:
 *   npm run gen:types    # write the file
 *   npm run test:types   # verify it is current
 */

import { exec } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(exec);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = join(ROOT, 'src', 'lib', 'database.types.ts');

let generated;
try {
  // `--linked` reads supabase/.temp/project-ref, which is gitignored and therefore absent on
  // a CI runner. SUPABASE_PROJECT_REF targets the project explicitly instead, so the gate
  // works both locally (linked) and in Actions (ref + access token) without a link step.
  const ref = process.env.SUPABASE_PROJECT_REF;
  const target = ref ? `--project-id ${ref}` : '--linked';

  // `exec` rather than `execFile`: on Windows `npx` is a .cmd shim, and since Node 20.12 the
  // runtime refuses to spawn one directly (EINVAL). exec goes through a shell, and the only
  // interpolated value is validated below, so there is nothing to inject.
  if (ref && !/^[a-z]{20}$/.test(ref)) {
    console.error(`✗ SUPABASE_PROJECT_REF is not a valid project ref: ${ref}`);
    process.exit(1);
  }

  const { stdout } = await run(
    `npx --silent supabase gen types typescript ${target}`,
    { cwd: ROOT, maxBuffer: 16 * 1024 * 1024 }
  );
  generated = stdout;
} catch (error) {
  console.error('✗ Could not generate types from the linked project.');
  console.error('  This gate needs `supabase login` and `supabase link` to have been run.');
  console.error(`  ${error.stderr?.trim() || error.message}`);
  process.exit(1);
}

let current;
try {
  current = await readFile(TARGET, 'utf8');
} catch {
  console.error(`✗ ${TARGET} is missing. Run: npm run gen:types`);
  process.exit(1);
}

// The repository is checked out with CRLF on Windows; the generator emits LF.
const normalise = (s) => s.replace(/\r\n/g, '\n').trimEnd();

if (normalise(current) !== normalise(generated)) {
  console.error(
    '✗ src/lib/database.types.ts is out of date with the applied migrations.\n' +
    '  A migration changed the schema and the generated types were not refreshed, so\n' +
    '  TypeScript is now checking the app against a schema that no longer exists.\n' +
    '  Run: npm run gen:types'
  );
  process.exit(1);
}

console.log('✓ database.types.ts matches the applied migrations.');
