#!/usr/bin/env node
/**
 * Run Supabase's own database linters and fail on anything that is not explicitly accepted.
 *
 * Usage:  node scripts/check-supabase-advisors.mjs security
 *         node scripts/check-supabase-advisors.mjs performance
 *
 * WHY THIS IS A SCRIPT AND NOT THREE LINES OF SHELL
 *
 * It used to be three lines of shell in `ci.yml`:
 *
 *     result=$(npx --silent supabase db advisors ... --type security 2>&1)
 *     if echo "$result" | grep -o '"name":"[^"]*"' | grep -v 'auth_leaked_password_protection' ...
 *
 * That grep matches `"name":"x"` with no space after the colon — compact JSON. The Supabase
 * CLI only emits compact JSON when it detects an AI agent in the environment. On a CI runner
 * it pretty-prints, so every key is `"name": "x"`, the grep matches nothing, and the step
 * passes. **A real security finding would have been reported as green** (DEF-056). The gate
 * that existed to catch a table left without RLS could not have caught one.
 *
 * Two things follow, and both are load-bearing:
 *
 *   1. `--output-format json --agent no` states the output shape explicitly, so it is a
 *      property of the command rather than of who happened to run it.
 *   2. Unparseable output is a FAILURE, never a pass. A gate that cannot read its own input
 *      knows nothing, and "knows nothing" must never render as green.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(exec);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Accepted findings, per advisor type. Anything not listed here fails the gate.
 *
 * `auth_leaked_password_protection` is a Pro-plan feature this project does not pay for. It is
 * answered client-side instead, in `src/lib/password-safety.ts`, which checks the same
 * HaveIBeenPwned range API at signup. Removing that module means removing this exemption.
 */
const ACCEPTED = {
  security: new Set(['auth_leaked_password_protection']),
  performance: new Set(),
};

/**
 * Performance advice is graded, and only ERROR blocks. INFO findings on a project this size
 * are things like an unused index on a table with fifty rows; treating them as failures would
 * train everyone to ignore the gate.
 */
const BLOCKING_LEVELS = {
  security: null, // every level blocks — a WARN here is still a security finding
  performance: new Set(['ERROR']),
};

const type = process.argv[2];
if (!Object.hasOwn(ACCEPTED, type)) {
  console.error(`✗ Usage: node scripts/check-supabase-advisors.mjs <${Object.keys(ACCEPTED).join('|')}>`);
  process.exit(1);
}

// Validated before interpolation for the same reason as in check-migrations-applied.mjs:
// `exec` goes through a shell because `npx` is a .cmd shim on Windows, so the only value that
// reaches the command line must be provably a project ref and nothing else.
const ref = process.env.SUPABASE_PROJECT_REF;
if (ref && !/^[a-z]{20}$/.test(ref)) {
  console.error(`✗ SUPABASE_PROJECT_REF is not a valid project ref: ${ref}`);
  process.exit(1);
}

// No `supabase link` — see DEF-053. `--linked --project-ref <ref>` needs no link file, and the
// two flags are mutually exclusive only when `--linked` is omitted.
const target = ref ? `--linked --project-ref ${ref}` : '--linked';

let raw;
try {
  const { stdout } = await run(
    `npx --silent supabase db advisors ${target} --type ${type} --output-format json --agent no`,
    { cwd: ROOT, maxBuffer: 16 * 1024 * 1024 }
  );
  raw = stdout;
} catch (error) {
  console.error(`✗ Could not run the ${type} advisors.`);
  console.error('  This gate needs SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF. It does NOT');
  console.error('  need a link step in CI — see DEF-053.');
  console.error(`  ${error.stderr?.trim() || error.message}`);
  process.exit(1);
}

// The CLI prints progress lines ("Initialising login role...") before the payload, so take the
// last JSON object. Failing to find one is a failure, not a pass.
const match = raw.match(/\{[\s\S]*\}\s*$/);
if (!match) {
  console.error(`✗ Could not parse the ${type} advisor output.`);
  console.error('  Expected a JSON object from `--output-format json`. If this printed a table');
  console.error('  or pretty-printed JSON instead, the CLI ignored the flag — see DEF-056.');
  console.error('  A gate that cannot read its own input fails; it never passes quietly.');
  console.error(raw.slice(0, 800));
  process.exit(1);
}

let results;
try {
  ({ results } = JSON.parse(match[0]));
} catch (error) {
  console.error(`✗ The ${type} advisor output was not valid JSON: ${error.message}`);
  process.exit(1);
}

if (!Array.isArray(results)) {
  console.error(`✗ The ${type} advisor output had no "results" array. Shape changed upstream.`);
  console.error(match[0].slice(0, 800));
  process.exit(1);
}

const accepted = ACCEPTED[type];
const blocking = BLOCKING_LEVELS[type];

const failures = results.filter((finding) => {
  if (accepted.has(finding.name)) return false;
  if (blocking && !blocking.has(finding.level)) return false;
  return true;
});

for (const finding of results) {
  const verdict = failures.includes(finding)
    ? 'FAIL'
    : accepted.has(finding.name)
      ? 'accepted'
      : 'below threshold';
  console.log(`  [${finding.level}] ${finding.name} — ${verdict}`);
  if (finding.metadata?.name) console.log(`      entity: ${finding.metadata.name}`);
}

if (failures.length === 0) {
  console.log(`✓ ${type} advisors: ${results.length} finding(s), none blocking.`);
  process.exit(0);
}

console.error(`\n✗ ${failures.length} blocking ${type} finding(s):`);
for (const finding of failures) {
  console.error(`\n  ${finding.name} (${finding.level})`);
  console.error(`    ${finding.title}`);
  if (finding.detail) console.error(`    ${finding.detail}`);
  if (finding.remediation) console.error(`    ${finding.remediation}`);
}
console.error(
  '\n  Fix the finding, or — if it is genuinely accepted — add it to ACCEPTED in this file\n' +
  '  with the reason written down. An unexplained exemption is how a gate rots.'
);
process.exit(1);
