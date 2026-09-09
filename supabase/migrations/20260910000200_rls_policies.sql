-- EquipCert AI — row level security
--
-- Three problems with the previous policy set are fixed here.
--
-- 1. RECURSION. Every policy was shaped
--      org_id IN (SELECT org_id FROM profiles WHERE user_id = auth.uid())
--    including the policy ON profiles itself. A policy that queries its own table has to
--    evaluate that table's policy to answer, which is a self-reference Postgres resolves by
--    erroring. It also re-ran `auth.uid()` and a subquery for every candidate row.
--    Fixed by resolving the caller's organisation ONCE, in a SECURITY DEFINER helper that is
--    not itself subject to RLS, and calling it as a scalar subquery so the planner evaluates
--    it a single time per statement rather than per row.
--
-- 2. NO WRITE SEPARATION. Everything was `FOR ALL`, so a technician had exactly the same
--    rights over schedules, equipment and audit records as an administrator. Policies are now
--    per operation and per role.
--
-- 3. PRIVILEGE ESCALATION. `profiles` allowed a user to UPDATE their own row with no
--    restriction on which columns. Any technician could set their own `role` to 'admin', or
--    move themselves into another organisation by rewriting `org_id`. Both are now blocked by
--    a trigger, because a policy alone cannot express "this column may not change".

-- ---------------------------------------------------------------------------
-- Caller identity helpers.
--
-- SECURITY DEFINER so they read `profiles` with the definer's rights and therefore break the
-- recursion. STABLE so the planner may evaluate them once per statement.
-- `SET search_path = ''` is mandatory on a SECURITY DEFINER function: without it a caller who
-- can create objects could shadow `profiles` with their own table and have this function
-- return whatever they like. Every identifier below is therefore schema-qualified.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.current_org_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT p.org_id FROM public.profiles p WHERE p.user_id = (SELECT auth.uid());
$$;

CREATE OR REPLACE FUNCTION app.current_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT p.role FROM public.profiles p WHERE p.user_id = (SELECT auth.uid());
$$;

/* True when the caller may administer the organisation's configuration. */
CREATE OR REPLACE FUNCTION app.is_manager()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(app.current_role() IN ('admin', 'manager'), false);
$$;

CREATE OR REPLACE FUNCTION app.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(app.current_role() = 'admin', false);
$$;

-- The helpers are callable by signed-in users; the schema itself stays closed so nothing else
-- inside it is reachable through PostgREST.
GRANT USAGE ON SCHEMA app TO authenticated;
GRANT EXECUTE ON FUNCTION app.current_org_id(), app.current_role(),
                          app.is_manager(), app.is_admin() TO authenticated;

-- ---------------------------------------------------------------------------
-- Enable and FORCE RLS.
--
-- FORCE also subjects the table owner to these policies. Without it, anything connecting as
-- the owning role reads every tenant's data. `service_role` carries the BYPASSRLS attribute
-- and is deliberately unaffected — that is the documented escape hatch for server handlers.
-- ---------------------------------------------------------------------------
ALTER TABLE public.organizations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations      FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles           FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.equipment          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment          FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.inspections        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspections        FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.corrective_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corrective_actions FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.schedules          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules          FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.notifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications      FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.audit_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log          FORCE  ROW LEVEL SECURITY;
-- plan_limits is reference data seeded by a migration running as the owner, so it is NOT
-- forced; forcing it would lock the seed out of its own table.
ALTER TABLE public.plan_limits        ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- plan_limits — readable by any signed-in user, writable only by a migration.
-- ---------------------------------------------------------------------------
CREATE POLICY plan_limits_read ON public.plan_limits
  FOR SELECT TO authenticated USING (true);

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
CREATE POLICY organizations_select_own ON public.organizations
  FOR SELECT TO authenticated
  USING (id = (SELECT app.current_org_id()));

CREATE POLICY organizations_update_admin ON public.organizations
  FOR UPDATE TO authenticated
  USING (id = (SELECT app.current_org_id()) AND (SELECT app.is_admin()))
  WITH CHECK (id = (SELECT app.current_org_id()));

-- Signup only: a user with no profile yet is creating the organisation they are about to
-- join. Once they have a profile this stops matching, so nobody can mint extra tenants.
CREATE POLICY organizations_insert_during_signup ON public.organizations
  FOR INSERT TO authenticated
  WITH CHECK (NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.user_id = (SELECT auth.uid())
  ));

-- No DELETE policy. Deleting a tenant cascades into its inspection history, which customers
-- are legally required to retain; it is a support operation, not a self-service button.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
CREATE POLICY profiles_select_org ON public.profiles
  FOR SELECT TO authenticated
  USING (org_id = (SELECT app.current_org_id()));

CREATE POLICY profiles_insert_self ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

-- A user may edit their own profile; an admin may edit anyone in their organisation. Which
-- COLUMNS may change is enforced by the trigger below, not here.
CREATE POLICY profiles_update_self_or_admin ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (org_id = (SELECT app.current_org_id()) AND (SELECT app.is_admin()))
  )
  WITH CHECK (org_id = (SELECT app.current_org_id()));

CREATE POLICY profiles_delete_admin ON public.profiles
  FOR DELETE TO authenticated
  USING (
    org_id = (SELECT app.current_org_id())
    AND (SELECT app.is_admin())
    -- An admin removing their own profile would orphan the organisation.
    AND user_id <> (SELECT auth.uid())
  );

/*
 * Column-level guard for profiles.
 *
 * RLS answers "may this row be written". It cannot answer "may this FIELD change", and that
 * is exactly the gap that let a technician promote themselves: the row was theirs, so the
 * policy passed, and `role` was just another column in the UPDATE.
 */
CREATE OR REPLACE FUNCTION app.guard_profile_privileges()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Moving a profile between tenants is never a legitimate update. It would carry the user
  -- into another customer's data with a policy check that still passes.
  IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'A profile cannot be moved between organizations.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Only an admin may change a role, and never their own — self-promotion and
  -- self-demotion are both administrative acts that need a second person.
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF NOT app.is_admin() THEN
      RAISE EXCEPTION 'Only an administrator may change a role.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.user_id = (SELECT auth.uid()) THEN
      RAISE EXCEPTION 'An administrator cannot change their own role.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- ESIGN evidence is written once, when consent is actually given.
  IF OLD.esign_consent AND NOT NEW.esign_consent THEN
    RAISE EXCEPTION 'Recorded e-signature consent cannot be withdrawn by editing the profile.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profile_privileges ON public.profiles;
CREATE TRIGGER guard_profile_privileges
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION app.guard_profile_privileges();

-- ---------------------------------------------------------------------------
-- equipment — everyone in the org reads; only managers and admins change the register.
-- ---------------------------------------------------------------------------
CREATE POLICY equipment_select_org ON public.equipment
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT app.current_org_id()));

CREATE POLICY equipment_insert_manager ON public.equipment
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT app.current_org_id()) AND (SELECT app.is_manager()));

CREATE POLICY equipment_update_manager ON public.equipment
  FOR UPDATE TO authenticated
  USING (organization_id = (SELECT app.current_org_id()) AND (SELECT app.is_manager()))
  WITH CHECK (organization_id = (SELECT app.current_org_id()));

CREATE POLICY equipment_delete_admin ON public.equipment
  FOR DELETE TO authenticated
  USING (organization_id = (SELECT app.current_org_id()) AND (SELECT app.is_admin()));

-- ---------------------------------------------------------------------------
-- inspections — any member may record one; nobody may quietly rewrite history.
-- ---------------------------------------------------------------------------
CREATE POLICY inspections_select_org ON public.inspections
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT app.current_org_id()));

CREATE POLICY inspections_insert_member ON public.inspections
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT app.current_org_id()));

-- Correcting a typo before signature is legitimate; it is a supervisory act.
CREATE POLICY inspections_update_manager ON public.inspections
  FOR UPDATE TO authenticated
  USING (organization_id = (SELECT app.current_org_id()) AND (SELECT app.is_manager()))
  WITH CHECK (organization_id = (SELECT app.current_org_id()));

CREATE POLICY inspections_delete_admin ON public.inspections
  FOR DELETE TO authenticated
  USING (organization_id = (SELECT app.current_org_id()) AND (SELECT app.is_admin()));

/*
 * The single spelling of a redacted person, shared by the erasure routine and by the trigger
 * that validates it. Two literals would drift, and the day they do, the immutability trigger
 * starts rejecting the erasure it exists to permit.
 */
CREATE OR REPLACE FUNCTION app.redacted_subject_label()
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT 'Erased at subject request';
$$;

/*
 * Immutability of a signed record.
 *
 * Two things are fixed here.
 *
 * THE DELETE BUG. The previous version was declared `BEFORE UPDATE OR DELETE` and ended
 * `RETURN NEW`. In a BEFORE DELETE row trigger NEW is NULL, and returning NULL from a BEFORE
 * row trigger CANCELS the operation. So deleting an unsigned inspection reported success and
 * silently did nothing — the caller believed the row was gone while it was still there.
 * Returning OLD on DELETE is what actually lets the delete proceed.
 *
 * ERASURE. A blanket "signed records never change" makes GDPR Article 17 impossible to
 * honour, because the inspector's name sits inside the very record NFPA 10 requires the
 * customer to keep. The resolution is to separate the person from the record: the finding,
 * the equipment and the timestamp are immutable forever, while the identifying columns may
 * be cleared exactly once, into a fixed redacted shape.
 *
 * That carve-out is expressed as a COLUMN allow-list rather than as a session flag. A flag
 * (`SET app.erasure = on`) would be settable by any client that can open a connection, which
 * would hand every user a switch that disables evidence immutability. Comparing the two row
 * versions cannot be talked out of anything.
 */
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

DROP TRIGGER IF EXISTS enforce_signed_immutability ON public.inspections;
CREATE TRIGGER enforce_signed_immutability
  BEFORE UPDATE OR DELETE ON public.inspections
  FOR EACH ROW EXECUTE FUNCTION app.prevent_signed_inspection_change();

-- ---------------------------------------------------------------------------
-- corrective_actions
-- ---------------------------------------------------------------------------
CREATE POLICY corrective_select_org ON public.corrective_actions
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT app.current_org_id()));

CREATE POLICY corrective_insert_member ON public.corrective_actions
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT app.current_org_id()));

-- A technician resolves what is assigned to them; a manager may act on anything in the org.
CREATE POLICY corrective_update_assignee_or_manager ON public.corrective_actions
  FOR UPDATE TO authenticated
  USING (
    organization_id = (SELECT app.current_org_id())
    AND (
      (SELECT app.is_manager())
      OR assigned_to IN (
        SELECT p.id FROM public.profiles p WHERE p.user_id = (SELECT auth.uid())
      )
    )
  )
  WITH CHECK (organization_id = (SELECT app.current_org_id()));

CREATE POLICY corrective_delete_admin ON public.corrective_actions
  FOR DELETE TO authenticated
  USING (organization_id = (SELECT app.current_org_id()) AND (SELECT app.is_admin()));

-- ---------------------------------------------------------------------------
-- schedules — a technician must not be able to move their own inspection due dates.
-- ---------------------------------------------------------------------------
CREATE POLICY schedules_select_org ON public.schedules
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT app.current_org_id()));

CREATE POLICY schedules_write_manager ON public.schedules
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT app.current_org_id()) AND (SELECT app.is_manager()));

CREATE POLICY schedules_update_manager ON public.schedules
  FOR UPDATE TO authenticated
  USING (organization_id = (SELECT app.current_org_id()) AND (SELECT app.is_manager()))
  WITH CHECK (organization_id = (SELECT app.current_org_id()));

CREATE POLICY schedules_delete_manager ON public.schedules
  FOR DELETE TO authenticated
  USING (organization_id = (SELECT app.current_org_id()) AND (SELECT app.is_manager()));

-- ---------------------------------------------------------------------------
-- notifications — strictly the recipient's own.
-- ---------------------------------------------------------------------------
CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Marking as read is the only update a recipient performs.
CREATE POLICY notifications_update_own ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY notifications_insert_org ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (org_id = (SELECT app.current_org_id()));

CREATE POLICY notifications_delete_own ON public.notifications
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- audit_log — append-only, and not readable by the people it audits.
-- ---------------------------------------------------------------------------
CREATE POLICY audit_select_manager ON public.audit_log
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT app.current_org_id()) AND (SELECT app.is_manager()));

CREATE POLICY audit_insert_org ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT app.current_org_id()));

-- No UPDATE or DELETE policy exists, so RLS denies both by default. The trigger below is the
-- belt to that braces: it also stops anything connecting as the table owner, and it makes the
-- intent explicit to the next reader instead of relying on an absence.
CREATE OR REPLACE FUNCTION app.audit_log_is_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'The audit log is append-only; % is not permitted.', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS audit_log_append_only ON public.audit_log;
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION app.audit_log_is_append_only();

-- ---------------------------------------------------------------------------
-- Default privileges.
--
-- `anon` is the key that ships inside the static export and inside both mobile apps. It must
-- reach nothing but the auth endpoints. Revoking here means a table added later without a
-- policy fails closed rather than being readable by the whole internet.
-- ---------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
