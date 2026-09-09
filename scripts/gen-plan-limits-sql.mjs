#!/usr/bin/env node
/**
 * Generate the plan_limits seed migration from src/lib/plans.ts.
 *
 * WHY THIS EXISTS
 *
 * The previous schema enforced the free-plan cap with a literal:
 *
 *     IF monthly_count >= 10 THEN RAISE EXCEPTION 'Free plan limit: 10 inspections...'
 *
 * while src/lib/plans.ts declared itself the single owner of plan limits (Rule 12). Two
 * copies of a number that changes whenever pricing changes, and the SQL copy is the one
 * nobody would think to edit. The pricing page would say 25 while the database still
 * rejected the 11th inspection.
 *
 * So plans.ts stays the owner and the database FOLLOWS it: this script derives the seed and
 * `--check` fails the build if the committed migration no longer matches the source. The
 * gate is what makes the ownership real rather than a comment.
 *
 * Usage:
 *   node scripts/gen-plan-limits-sql.mjs           # write the migration
 *   node scripts/gen-plan-limits-sql.mjs --check   # verify it is current, exit 1 if not
 */

import { build } from 'esbuild';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'src', 'lib', 'plans.ts');
const TARGET = join(ROOT, 'supabase', 'migrations', '20260910000500_plan_limits.sql');

/**
 * Load PLANS out of the TypeScript source.
 *
 * Transpiled through esbuild rather than parsed with a regular expression: a regex over
 * source is exactly the kind of brittle coupling this script exists to remove, and esbuild
 * is already a devDependency for the server bundle.
 */
async function loadPlans() {
  const dir = await mkdtemp(join(tmpdir(), 'equipcert-plans-'));
  const out = join(dir, 'plans.mjs');
  try {
    await build({
      entryPoints: [SOURCE],
      outfile: out,
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      logLevel: 'warning',
    });
    const mod = await import(pathToFileURL(out).href);
    return { plans: mod.PLANS, canAccess: mod.canAccess };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** SQL literal for a limit. JS uses Infinity for "unlimited"; SQL has no such integer. */
function limitLiteral(value) {
  return Number.isFinite(value) ? String(value) : 'NULL';
}

function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function render(plans, canAccess) {
  const rows = Object.values(plans).map((plan) => {
    // Asked of canAccess(), not scraped from the feature bullets. The first draft of this
    // script matched /signature/i against plan.features and produced
    // `enterprise -> false`, because Enterprise's list reads "Everything in Pro" and never
    // repeats the word. Display copy describes a plan; canAccess() DEFINES it.
    const signatures = canAccess(plan.id, 'signatures');
    return `  (${sqlQuote(plan.id)}, ${limitLiteral(plan.limits.users)}, ` +
      `${limitLiteral(plan.limits.inspectionsPerMonth)}, ` +
      `${limitLiteral(plan.limits.aiAnalysesPerMonth)}, ${signatures})`;
  });

  return `-- EquipCert AI — plan limits seed
--
-- GENERATED FILE. Do not edit by hand.
--   Source:    src/lib/plans.ts
--   Generator: scripts/gen-plan-limits-sql.mjs
--   Verify:    npm run test:config  (fails the build if this drifts from the source)
--
-- NULL means unlimited. plans.ts expresses that as Infinity, which has no integer equivalent
-- in SQL, so the absence of a limit is modelled as the absence of a value.
--
-- \`allows_signatures\` is derived from whether the plan's own feature list mentions digital
-- signatures, so the pricing page and the database gate cannot disagree about what a customer
-- was sold.

INSERT INTO public.plan_limits
  (plan_id, max_users, max_inspections_month, max_ai_analyses_month, allows_signatures)
VALUES
${rows.join(',\n')}
ON CONFLICT (plan_id) DO UPDATE SET
  max_users             = EXCLUDED.max_users,
  max_inspections_month = EXCLUDED.max_inspections_month,
  max_ai_analyses_month = EXCLUDED.max_ai_analyses_month,
  allows_signatures     = EXCLUDED.allows_signatures;

-- ---------------------------------------------------------------------------
-- Enforcement.
--
-- The cap is applied server-side, in the database, because a client-side check is a
-- suggestion: the anon key ships inside the static export and inside both mobile apps, so
-- anyone can call PostgREST directly and skip whatever the UI decided.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.enforce_plan_limits()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_limits public.plan_limits%ROWTYPE;
  v_count  INT;
BEGIN
  SELECT pl.* INTO v_limits
    FROM public.organizations o
    JOIN public.plan_limits pl ON pl.plan_id = o.plan
   WHERE o.id = NEW.organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown organization or plan for %', NEW.organization_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_limits.max_inspections_month IS NOT NULL THEN
    SELECT count(*) INTO v_count
      FROM public.inspections i
     WHERE i.organization_id = NEW.organization_id
       AND i.created_at >= date_trunc('month', now());

    IF v_count >= v_limits.max_inspections_month THEN
      RAISE EXCEPTION
        'Plan limit reached: % inspections per month. Upgrade to continue.',
        v_limits.max_inspections_month
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.signature_url IS NOT NULL AND NOT v_limits.allows_signatures THEN
    RAISE EXCEPTION 'Digital signatures are not included in this plan.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS enforce_plan_limits ON public.inspections;
CREATE TRIGGER enforce_plan_limits
  BEFORE INSERT ON public.inspections
  FOR EACH ROW EXECUTE FUNCTION app.enforce_plan_limits();
`;
}

const { plans, canAccess } = await loadPlans();
const generated = render(plans, canAccess);
const check = process.argv.includes('--check');

if (check) {
  let current = null;
  try {
    current = await readFile(TARGET, 'utf8');
  } catch {
    console.error(`✗ ${TARGET} is missing. Run: node scripts/gen-plan-limits-sql.mjs`);
    process.exit(1);
  }
  // Normalise line endings: the repo is checked out with CRLF on Windows.
  if (current.replace(/\r\n/g, '\n') !== generated.replace(/\r\n/g, '\n')) {
    console.error(
      '✗ plan_limits migration is out of date with src/lib/plans.ts.\n' +
      '  A plan limit changed in TypeScript but the database seed was not regenerated.\n' +
      '  Run: node scripts/gen-plan-limits-sql.mjs'
    );
    process.exit(1);
  }
  console.log('✓ plan_limits migration matches src/lib/plans.ts.');
} else {
  await writeFile(TARGET, generated, 'utf8');
  console.log(`✓ Wrote ${TARGET} from src/lib/plans.ts (${Object.keys(plans).length} plans).`);
}
