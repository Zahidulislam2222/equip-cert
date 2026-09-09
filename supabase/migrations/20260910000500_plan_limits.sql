-- EquipCert AI — plan limits seed
--
-- GENERATED FILE. Do not edit by hand.
--   Source:    src/lib/plans.ts
--   Generator: scripts/gen-plan-limits-sql.mjs
--   Verify:    npm run test:config  (fails the build if this drifts from the source)
--
-- NULL means unlimited. plans.ts expresses that as Infinity, which has no integer equivalent
-- in SQL, so the absence of a limit is modelled as the absence of a value.
--
-- `allows_signatures` is derived from whether the plan's own feature list mentions digital
-- signatures, so the pricing page and the database gate cannot disagree about what a customer
-- was sold.

INSERT INTO public.plan_limits
  (plan_id, max_users, max_inspections_month, max_ai_analyses_month, allows_signatures)
VALUES
  ('free', 1, 10, 5, false),
  ('pro', NULL, NULL, NULL, true),
  ('enterprise', NULL, NULL, NULL, true)
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
