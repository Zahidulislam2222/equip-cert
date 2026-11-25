-- =============================================================================
-- Two defects found by the end-to-end pass of 2026-11-25.
--
-- 1. An administrator could not remove a member who had ever signed an inspection (DEF-091).
--    Removal deletes the profile; inspections.inspector_id is ON DELETE SET NULL; the referential
--    action is an UPDATE of a signed row, and app.prevent_signed_inspection_change accepted only a
--    COMPLETE erasure (name, location and device info too). So the delete failed with
--    "A signed inspection record may only be changed by a complete erasure of the subject", and the
--    Team page promised the opposite ("Their signed inspections stay on record under their name").
--
--    Fix: one more permitted change, as narrow as it can be — inspector_id becomes NULL, every other
--    column is byte-identical, and the profile it pointed to no longer exists. That is exactly the
--    shape of the foreign key's SET NULL after a removal. The record keeps the signer's name, the
--    signature and every other field. A hand-written UPDATE that nulls inspector_id while the
--    profile still exists is still refused.
--
-- 2. Inspections never advanced equipment due dates (DEF-092). equipment.last_inspection_date,
--    equipment.next_due_date and schedules.next_due were only ever written by hand, so "overdue"
--    in Reports, the dashboard and the assistant could never clear by doing the inspection.
--
--    Fix: after an inspection that names equipment is filed, stamp the equipment, advance every
--    active schedule for it by its own frequency, and set the equipment's next due date to the
--    earliest of them. Equipment from another organisation is refused outright.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Member removal
-- ---------------------------------------------------------------------------

-- Existence check that RLS cannot hide (a manager must not be able to null the inspector of a
-- signed record merely because the inspector's profile is invisible to them).
CREATE OR REPLACE FUNCTION app.profile_exists(p_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_id);
$$;
REVOKE ALL ON FUNCTION app.profile_exists(UUID) FROM PUBLIC, anon;
-- prevent_signed_inspection_change is SECURITY INVOKER, and Postgres checks EXECUTE on every
-- function in an expression when it prepares it, whichever branch runs. Without this grant a
-- manager's UPDATE of a signed row fails with "permission denied for function" instead of the
-- immutability rule, and a test of the rule would pass for the wrong reason. It answers only
-- "does this profile id exist", for an unguessable UUID.
GRANT EXECUTE ON FUNCTION app.profile_exists(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION app.prevent_signed_inspection_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  -- The only columns an erasure is permitted to touch.
  erasable CONSTANT TEXT[] := ARRAY['inspector_name', 'inspector_id',
                                    'location_lat', 'location_lng', 'device_info'];
BEGIN
  IF OLD.signature_url IS NULL THEN
    -- Not yet signed: ordinary rules apply, and the RLS policies already decided who may act.
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  -- Signed. Deletion is never available, by anyone, for any reason.
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'A signed inspection record cannot be deleted (ESIGN / NFPA 10 evidence).'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- The member who signed was removed from the organisation (DEF-091): the foreign key sets
  -- inspector_id to NULL and changes nothing else. Their name and signature stay on the record.
  IF OLD.inspector_id IS NOT NULL
     AND NEW.inspector_id IS NULL
     AND (to_jsonb(OLD) - 'inspector_id') = (to_jsonb(NEW) - 'inspector_id')
     AND NOT app.profile_exists(OLD.inspector_id) THEN
    RETURN NEW;
  END IF;

  -- Every column outside the erasure allow-list must be byte-identical.
  IF (to_jsonb(OLD) - erasable) IS DISTINCT FROM (to_jsonb(NEW) - erasable) THEN
    RAISE EXCEPTION
      'A signed inspection record is immutable (ESIGN / NFPA 10 evidence).'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- And the permitted change must actually BE an erasure, not an edit dressed as one. This
  -- is the exact shape app.anonymize_profile() writes; anything else is rejected.
  IF NOT (NEW.inspector_id IS NULL
          AND NEW.location_lat IS NULL
          AND NEW.location_lng IS NULL
          AND NEW.device_info = '{}'::jsonb
          AND NEW.inspector_name = app.redacted_subject_label()) THEN
    RAISE EXCEPTION
      'A signed inspection record may only be changed by a complete erasure of the subject.'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Inspections advance due dates
-- ---------------------------------------------------------------------------

-- The record's time is the server's (AGENTS.md: "Timestamps are server-generated"). The column only
-- had a DEFAULT, so any client could send created_at and backdate a compliance record — and, with the
-- trigger below, push the equipment's due dates years ahead (fresh review, 2026-11-25). No client
-- sends it; offline captures keep their device time in the queue, not in this column.
CREATE OR REPLACE FUNCTION app.server_created_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.created_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app.server_created_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS server_created_at ON public.inspections;
CREATE TRIGGER server_created_at
  BEFORE INSERT ON public.inspections
  FOR EACH ROW
  EXECUTE FUNCTION app.server_created_at();

-- An inspection may only name its own organisation's equipment — on INSERT and when an unsigned
-- record is later edited (the foreign key alone accepts any organisation's id).
CREATE OR REPLACE FUNCTION app.inspection_equipment_same_org()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.equipment e
                  WHERE e.id = NEW.equipment_id AND e.organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'That equipment does not belong to this organisation.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app.inspection_equipment_same_org() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS inspection_equipment_same_org ON public.inspections;
CREATE TRIGGER inspection_equipment_same_org
  BEFORE INSERT OR UPDATE OF equipment_id, organization_id ON public.inspections
  FOR EACH ROW
  WHEN (NEW.equipment_id IS NOT NULL)
  EXECUTE FUNCTION app.inspection_equipment_same_org();

-- Every inspection of the asset counts as done, including one that FAILED: the failure is handled
-- by its corrective action, not by leaving the asset "overdue". Equipment with no active schedule
-- keeps its next_due_date (there is no frequency to compute one from). Dates are UTC.
CREATE OR REPLACE FUNCTION app.advance_due_dates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_at TIMESTAMPTZ := NEW.created_at;  -- server time, set by app.server_created_at()
BEGIN
  -- The schedule's own frequency decides the next date; nothing is assumed here.
  UPDATE public.schedules s
     SET last_completed = v_at,
         next_due = ((v_at AT TIME ZONE 'UTC') + CASE s.frequency
                               WHEN 'daily'     THEN interval '1 day'
                               WHEN 'weekly'    THEN interval '7 days'
                               WHEN 'monthly'   THEN interval '1 month'
                               WHEN 'quarterly' THEN interval '3 months'
                               WHEN 'annually'  THEN interval '1 year'
                             END)::date,
         updated_at = now()
   WHERE s.equipment_id = NEW.equipment_id
     AND s.is_active;

  UPDATE public.equipment e
     SET last_inspection_date = v_at,
         next_due_date = COALESCE(
           (SELECT min(s.next_due) FROM public.schedules s WHERE s.equipment_id = e.id AND s.is_active),
           e.next_due_date),
         updated_at = now()
   WHERE e.id = NEW.equipment_id;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app.advance_due_dates() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS advance_due_dates ON public.inspections;
CREATE TRIGGER advance_due_dates
  AFTER INSERT ON public.inspections
  FOR EACH ROW
  WHEN (NEW.equipment_id IS NOT NULL)
  EXECUTE FUNCTION app.advance_due_dates();
