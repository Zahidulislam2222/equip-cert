-- =============================================================================
-- Signing through an UPDATE must obey the same rules as signing on INSERT (review 2, 2026-11-25).
--
-- Both signature rules ran BEFORE INSERT only:
--   * app.enforce_plan_limits        — the plan must include digital signatures
--   * app.require_consenting_signer  — the signer is the inspector and has recorded ESIGN consent
-- while `inspections_update_manager` lets a manager update any UNSIGNED row, and
-- `prevent_signed_inspection_change` only protects rows that are ALREADY signed. So a manager could
-- insert an unsigned inspection naming a technician and then set `signature_url` with an UPDATE:
-- a signed, immutable record in the technician's name that the technician never consented to, on a
-- plan that does not include signatures.
--
-- Fix: run the consent rule on UPDATE OF signature_url as well, and add the plan's signature check
-- for the same transition. The function bodies are unchanged; the consent function already reads
-- only NEW, which is correct for both events.
-- =============================================================================

DROP TRIGGER IF EXISTS require_consenting_signer ON public.inspections;
CREATE TRIGGER require_consenting_signer
  BEFORE INSERT OR UPDATE OF signature_url ON public.inspections
  FOR EACH ROW EXECUTE FUNCTION app.require_consenting_signer();

-- Plan check for the unsigned -> signed transition. The monthly-count part of
-- app.enforce_plan_limits is about creating records and must not run on an edit, so this is a
-- separate, narrower function rather than a second trigger on the same one.
CREATE OR REPLACE FUNCTION app.enforce_signature_plan_on_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_allows BOOLEAN;
BEGIN
  SELECT pl.allows_signatures INTO v_allows
    FROM public.organizations o
    JOIN public.plan_limits pl ON pl.plan_id = o.plan
   WHERE o.id = NEW.organization_id;

  IF NOT FOUND OR NOT v_allows THEN
    RAISE EXCEPTION 'Digital signatures are not included in this plan.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION app.enforce_signature_plan_on_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_signature_plan_on_update ON public.inspections;
CREATE TRIGGER enforce_signature_plan_on_update
  BEFORE UPDATE OF signature_url ON public.inspections
  FOR EACH ROW
  WHEN (OLD.signature_url IS NULL AND NEW.signature_url IS NOT NULL)
  EXECUTE FUNCTION app.enforce_signature_plan_on_update();
