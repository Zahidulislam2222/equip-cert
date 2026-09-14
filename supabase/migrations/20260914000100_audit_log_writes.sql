-- EquipCert AI — write the audit log, and stop it from blocking erasure
--
-- TWO THINGS, AND THEY HAVE TO SHIP TOGETHER
--
-- 1. `public.audit_log` has existed since the core schema, append-only, RLS-forced, readable
--    only by managers — and NOTHING WROTE TO IT. The privacy policy and the Art. 30 record both
--    had to say so. An accountability record nobody writes is not an accountability control.
--
-- 2. DEF-059. `app.anonymize_profile()` — the GDPR Art. 17 erasure path — runs
--
--        UPDATE public.audit_log SET user_id = NULL, details = details - 'email' ...
--
--    and `audit_log_append_only` raises on EVERY update. The same trigger also rejects the
--    `ON DELETE SET NULL` that Postgres issues against `audit_log.user_id` when an auth user is
--    deleted, and the `ON DELETE CASCADE` issued when an organisation is deleted. All three were
--    latent only because the table was empty. Wiring audit writes (part 1) without this fix
--    would have made erasure, account deletion and tenant offboarding fail the first time anyone
--    had an audit entry. So the fix lands in the same migration as the writes, never before or
--    after.
--
-- WHY DATABASE TRIGGERS AND NOT APPLICATION CODE
--
-- Three clients write to this database: the web app, the Flutter app, and the service-role
-- handlers. An audit call in application code is an audit call someone can forget in one of the
-- three, and cannot see a write made from the SQL editor at all. A trigger records the write
-- whichever door it came through, in the same transaction, so an entry cannot exist for a write
-- that rolled back and a write cannot commit without its entry.
--
-- WHAT IS DELIBERATELY NOT RECORDED
--
-- No names, no email addresses, no free text, no IP address. Entries say WHAT changed (the
-- column names) and the few non-personal values that make the entry useful (a status, a role, a
-- plan). GDPR Art. 5(1)(c) data minimisation applies to logs too, and a log full of personal data
-- is one more thing an erasure has to find. The IP column stays in the table for handlers that
-- have a trustworthy address; a trigger does not — the forwarded-for header is client-supplied.

-- ---------------------------------------------------------------------------
-- The single definition of which detail keys count as personal data.
--
-- Shared by the erasure routine and the append-only trigger that validates it — the same
-- pattern as app.redacted_subject_label(). Two copies of this list would drift, and on the day
-- they did, the trigger would start rejecting the erasure it exists to permit.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.audit_personal_detail_keys()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  -- subject_user_id is written by the profiles trigger (member.created / role_changed): the UUID
  -- of the person an entry is ABOUT. It is pseudonymous personal data and must go on erasure too.
  SELECT ARRAY['email', 'full_name', 'ip_address', 'subject_user_id'];
$$;

-- ---------------------------------------------------------------------------
-- Append-only, with exactly two exceptions — both expressed as row comparisons, never as a flag.
--
--   REDACTION (UPDATE). The only permitted change moves a column TOWARDS less personal data:
--   user_id to NULL, ip_address to NULL, details to itself minus the personal keys. Every other
--   column must be identical. This covers app.anonymize_profile() AND the ON DELETE SET NULL that
--   Postgres issues when an auth user is removed — which is the same change.
--
--   TENANT REMOVAL (DELETE). Permitted only while cascading from the organisation's own deletion:
--   inside a trigger (the referential action) AND the organisation no longer exists. A direct
--   DELETE by any role, service role included, still raises.
--
-- A session flag (`SET app.redacting = on`) was rejected for the reason given on the inspection
-- immutability trigger: any client that can open a connection could set it, which would hand
-- every user a switch that disables the audit trail.
--
-- SECURITY DEFINER so that the organisation existence check is not answered by RLS. Under the
-- caller's policies a row they cannot see and a row that does not exist look identical, and that
-- confusion is exactly how an existence check turns into a bypass.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.audit_log_is_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  redactable CONSTANT TEXT[] := ARRAY['user_id', 'ip_address', 'details'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1
       AND NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = OLD.organization_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'The audit log is append-only; DELETE is not permitted.'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF (to_jsonb(OLD) - redactable) IS DISTINCT FROM (to_jsonb(NEW) - redactable)
     OR (NEW.user_id IS DISTINCT FROM OLD.user_id AND NEW.user_id IS NOT NULL)
     OR (NEW.ip_address IS DISTINCT FROM OLD.ip_address AND NEW.ip_address IS NOT NULL)
     -- details may lose personal keys (any subset — an entry BY the subject about someone else
     -- keeps that other person's reference) and nothing else: the non-personal remainder must be
     -- identical, and every key that remains must hold its original value.
     --
     -- CASE rather than AND/OR: SQL does not promise left-to-right evaluation, and subtracting keys
     -- from a JSON scalar raises. A non-object `details` could only have been written under the
     -- dropped client INSERT policy; such an entry may not be changed at all.
     --
     -- "Holds its original value" is checked key by key, not with @>: containment is recursive, so
     -- {"email":["a","b"]} @> {"email":["a"]} is true and a personal value could be shrunk.
     OR (CASE
           WHEN NEW.details IS NOT DISTINCT FROM OLD.details THEN false
           WHEN jsonb_typeof(OLD.details) IS DISTINCT FROM 'object'
             OR jsonb_typeof(NEW.details) IS DISTINCT FROM 'object' THEN true
           ELSE (OLD.details - app.audit_personal_detail_keys())
                  IS DISTINCT FROM (NEW.details - app.audit_personal_detail_keys())
                OR EXISTS (SELECT 1 FROM jsonb_each(NEW.details) AS e
                            WHERE OLD.details -> e.key IS DISTINCT FROM e.value)
         END) THEN
    RAISE EXCEPTION 'The audit log is append-only; an entry may be redacted, never edited.'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app.audit_log_is_append_only() FROM PUBLIC, anon, authenticated;

-- The trigger itself is unchanged in shape; it is recreated so this migration reads complete.
DROP TRIGGER IF EXISTS audit_log_append_only ON public.audit_log;
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION app.audit_log_is_append_only();

-- ---------------------------------------------------------------------------
-- Clients no longer write entries.
--
-- `audit_insert_org` let any signed-in member insert an entry into their own organisation's log
-- with any action, resource and details they liked — a technician could file
-- "inspection.created" for an inspection that never existed. With the triggers below as the
-- writer, a client-side INSERT has no legitimate use and every illegitimate one. Nothing in
-- src/, api/ or mobile/lib inserts into this table.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS audit_insert_org ON public.audit_log;

-- The definer functions below (the writer, and erasure's redaction) run as the function owner,
-- `postgres`. audit_log has FORCE ROW LEVEL SECURITY, which applies policies even to the owner;
-- only a role with BYPASSRLS skips them. Whether `postgres` holds BYPASSRLS differs between a local
-- stack and a hosted project, so it is not relied on: these policies grant the owner exactly what
-- the functions need. They grant clients nothing — `postgres` is not a role a JWT can assume — and
-- the append-only trigger still decides which UPDATE shapes are allowed.
DROP POLICY IF EXISTS audit_owner_insert ON public.audit_log;
CREATE POLICY audit_owner_insert ON public.audit_log
  FOR INSERT TO postgres WITH CHECK (true);
DROP POLICY IF EXISTS audit_owner_read ON public.audit_log;
CREATE POLICY audit_owner_read ON public.audit_log
  FOR SELECT TO postgres USING (true);
DROP POLICY IF EXISTS audit_owner_redact ON public.audit_log;
CREATE POLICY audit_owner_redact ON public.audit_log
  FOR UPDATE TO postgres USING (true) WITH CHECK (true);

-- Erasure finds a person by either reference. Without these the redaction is a scan of every
-- tenant's audit trail, holding row locks, that grows with the table. Two indexes rather than an
-- organisation filter: a person's entries are not guaranteed to sit in one organisation, and a
-- faster erasure that misses some of them is not an erasure.
CREATE INDEX IF NOT EXISTS audit_log_user_id_idx ON public.audit_log (user_id);
CREATE INDEX IF NOT EXISTS audit_log_subject_user_id_idx
  ON public.audit_log ((details ->> 'subject_user_id'));

-- ---------------------------------------------------------------------------
-- The writer.
--
-- One function for every audited table, so the entry shape cannot differ between them. AFTER ROW,
-- so it records what was committed rather than what was attempted, and returns NULL because an
-- AFTER trigger's return value is ignored.
--
-- SECURITY DEFINER because the entry must be written whoever the caller is — a technician has no
-- INSERT on another member's audit trail, and the service role has no tenant for the INSERT
-- policy to match. The function takes no input from the caller beyond the row the database just
-- wrote, which is what makes definer rights safe here.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.write_audit_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row     JSONB := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_old     JSONB := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  v_verb    TEXT  := CASE TG_OP WHEN 'INSERT' THEN 'created'
                                WHEN 'UPDATE' THEN 'updated'
                                ELSE 'deleted' END;
  v_org     UUID;
  v_action  TEXT;
  v_details JSONB := '{}'::jsonb;
  v_changed TEXT[];
BEGIN
  v_org := CASE TG_TABLE_NAME
             WHEN 'organizations' THEN (v_row->>'id')::uuid
             WHEN 'profiles'      THEN (v_row->>'org_id')::uuid
             ELSE (v_row->>'organization_id')::uuid
           END;

  -- A privacy request from someone with no account has no tenant to file an entry under. The
  -- request row itself carries its received time and statutory deadline.
  IF v_org IS NULL THEN
    RETURN NULL;
  END IF;

  -- The tenant is being deleted and this write is its cascade. There is nothing left to attach
  -- an entry to, and inserting one would fail the foreign key and abort the offboarding.
  IF NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = v_org) THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(k ORDER BY k) INTO v_changed
      FROM jsonb_object_keys(v_row) AS k
     WHERE k <> 'updated_at'
       AND (v_row -> k) IS DISTINCT FROM (v_old -> k);

    -- An UPDATE that changed nothing is not an event.
    IF v_changed IS NULL THEN
      RETURN NULL;
    END IF;
    v_details := jsonb_build_object('changed', to_jsonb(v_changed));
  END IF;

  CASE TG_TABLE_NAME
    WHEN 'inspections' THEN
      v_action := 'inspection.' || v_verb;
      IF TG_OP = 'UPDATE'
         AND v_row->>'inspector_name' = app.redacted_subject_label()
         AND (v_old->>'inspector_name') IS DISTINCT FROM app.redacted_subject_label() THEN
        v_action := 'inspection.subject_erased';
      END IF;
      v_details := v_details || jsonb_build_object(
        'status',      v_row -> 'status',
        'signed',      (v_row->>'signature_url') IS NOT NULL,
        'ai_assisted', v_row -> 'ai_assisted');

    WHEN 'corrective_actions' THEN
      v_action := 'corrective_action.' || v_verb;
      v_details := v_details || jsonb_build_object(
        'inspection_id', v_row -> 'inspection_id',
        'severity',      v_row -> 'severity',
        'status',        v_row -> 'status');
      IF TG_OP = 'UPDATE' AND (v_row->'status') IS DISTINCT FROM (v_old->'status') THEN
        v_details := v_details || jsonb_build_object('status_from', v_old -> 'status');
      END IF;

    WHEN 'profiles' THEN
      v_action := 'member.' || v_verb;
      IF TG_OP = 'UPDATE' AND (v_row->'role') IS DISTINCT FROM (v_old->'role') THEN
        v_action := 'member.role_changed';
        v_details := v_details || jsonb_build_object('role_from', v_old -> 'role');
      END IF;
      IF TG_OP = 'UPDATE'
         AND (v_row->>'anonymized_at') IS NOT NULL
         AND (v_old->>'anonymized_at') IS NULL THEN
        v_action := 'member.erased';
      END IF;
      v_details := v_details || jsonb_build_object(
        'role',            v_row -> 'role',
        'subject_user_id', CASE WHEN (v_row->>'anonymized_at') IS NULL THEN v_row -> 'user_id' END);

    WHEN 'organizations' THEN
      v_action := 'organization.' || v_verb;
      v_details := v_details || jsonb_build_object(
        'plan',             v_row -> 'plan',
        'retention_months', v_row -> 'retention_months');

    WHEN 'equipment' THEN
      v_action := 'equipment.' || v_verb;
      v_details := v_details || jsonb_build_object('status', v_row -> 'status');

    WHEN 'data_subject_requests' THEN
      v_action := CASE TG_OP WHEN 'INSERT' THEN 'privacy_request.received'
                             ELSE 'privacy_request.' || v_verb END;
      IF TG_OP = 'UPDATE' AND (v_row->'status') IS DISTINCT FROM (v_old->'status') THEN
        v_action := 'privacy_request.status_changed';
        v_details := v_details || jsonb_build_object('status_from', v_old -> 'status');
      END IF;
      v_details := v_details || jsonb_build_object(
        'request_type', v_row -> 'request_type',
        'regime',       v_row -> 'regime',
        'status',       v_row -> 'status',
        'due_at',       v_row -> 'due_at');

    WHEN 'consent_records' THEN
      -- Only an INSERT is a consent being recorded. The erasure cascade DELETEs these rows, and an
      -- entry saying "recorded" for a consent that was just removed would misstate the history.
      v_action := CASE TG_OP WHEN 'INSERT' THEN 'consent.recorded' ELSE 'consent.' || v_verb END;
      v_details := v_details || jsonb_build_object(
        'purpose',          v_row -> 'purpose',
        'granted',          v_row -> 'granted',
        'document_version', v_row -> 'document_version',
        'method',           v_row -> 'method');

    ELSE
      RAISE EXCEPTION 'app.write_audit_entry() is not configured for table %', TG_TABLE_NAME;
  END CASE;

  -- Strip nulls so an entry states what is known rather than listing what is not.
  v_details := jsonb_strip_nulls(v_details || jsonb_build_object('actor_role', auth.role()));

  -- The actor is looked up rather than taken from auth.uid() directly: when a user's own account
  -- is being deleted, the cascade runs inside their session, and an entry naming a user row that
  -- no longer exists would fail the foreign key and roll the deletion back.
  INSERT INTO public.audit_log (organization_id, user_id, action, resource_type, resource_id, details)
  VALUES (v_org,
          (SELECT u.id FROM auth.users u WHERE u.id = auth.uid()),
          v_action, TG_TABLE_NAME, v_row->>'id', v_details);

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION app.write_audit_entry() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  target TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY['inspections', 'corrective_actions', 'profiles', 'equipment',
                                'data_subject_requests', 'consent_records']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS write_audit_entry ON public.%I', target);
    EXECUTE format(
      'CREATE TRIGGER write_audit_entry AFTER INSERT OR UPDATE OR DELETE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION app.write_audit_entry()', target);
  END LOOP;
END $$;

-- Organisations: creation and changes only. Its deletion leaves no tenant to file the entry
-- under, and the entries it already has are removed with it by design.
DROP TRIGGER IF EXISTS write_audit_entry ON public.organizations;
CREATE TRIGGER write_audit_entry
  AFTER INSERT OR UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION app.write_audit_entry();

-- ---------------------------------------------------------------------------
-- Erasure, corrected.
--
-- Two changes against the compliance migration's version, both about what "erased" means:
--
--   * The audit redaction reads the personal-key list from its single owner instead of spelling
--     it out, so it cannot drift from the trigger that validates it.
--   * `ip_address` is cleared as a COLUMN. The previous version removed an 'ip_address' key from
--     `details` and left the column holding the address — an erasure that kept the one field most
--     likely to identify the person.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.anonymize_profile(p_profile_id UUID)
RETURNS TABLE (inspections_anonymized INT, corrective_actions_unassigned INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_label        TEXT := app.redacted_subject_label();
  v_user_id      UUID;
  v_inspections  INT;
  v_corrective   INT;
BEGIN
  SELECT p.user_id INTO v_user_id FROM public.profiles p WHERE p.id = p_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such profile: %', p_profile_id USING ERRCODE = 'no_data_found';
  END IF;

  -- 1. The inspection records — the write the immutability trigger explicitly permits.
  UPDATE public.inspections
     SET inspector_name = v_label,
         inspector_id   = NULL,
         location_lat   = NULL,
         location_lng   = NULL,
         device_info    = '{}'::jsonb
   WHERE inspector_id = p_profile_id;
  GET DIAGNOSTICS v_inspections = ROW_COUNT;

  -- 2. Work assignments carry the person forward by reference; drop the reference.
  UPDATE public.corrective_actions
     SET assigned_to = NULL
   WHERE assigned_to = p_profile_id;
  GET DIAGNOSTICS v_corrective = ROW_COUNT;

  UPDATE public.corrective_actions SET resolved_by = NULL WHERE resolved_by = p_profile_id;
  UPDATE public.schedules          SET assigned_to = NULL WHERE assigned_to = p_profile_id;

  -- 3. The profile itself.
  UPDATE public.profiles
     SET full_name      = v_label,
         qualifications = NULL,
         avatar_url     = NULL,
         anonymized_at  = now()
   WHERE id = p_profile_id;

  -- 4. The audit trail records that an action happened, not who the person was — whether the
  --    person ACTED (user_id) or the entry is ABOUT them (details.subject_user_id). Other people's
  --    references in the same entries are kept: an admin who changed this person's role stays the
  --    recorded actor. This is the exact shape audit_log_is_append_only() permits.
  UPDATE public.audit_log
     SET user_id    = CASE WHEN user_id = v_user_id THEN NULL ELSE user_id END,
         ip_address = CASE WHEN user_id = v_user_id THEN NULL ELSE ip_address END,
         details    = CASE
                        -- A legacy non-object value cannot have keys removed; the columns above
                        -- are still redacted, and the guard accepts an unchanged `details`.
                        WHEN jsonb_typeof(details) IS DISTINCT FROM 'object' THEN details
                        WHEN details ->> 'subject_user_id' = v_user_id::text
                          THEN details - app.audit_personal_detail_keys()
                        ELSE details - array_remove(app.audit_personal_detail_keys(), 'subject_user_id')
                      END
   WHERE user_id = v_user_id
      OR details ->> 'subject_user_id' = v_user_id::text;

  -- 5. Finally the login. Last, because the steps above key off it.
  DELETE FROM auth.users WHERE id = v_user_id;

  inspections_anonymized        := v_inspections;
  corrective_actions_unassigned := v_corrective;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION app.anonymize_profile(UUID) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A callable erasure entry point, for the service role only.
--
-- `app` is not exposed through the API, which is right for the implementation and meant the
-- erasure could not be invoked by the one server-side caller that fulfils a verified request.
-- This wrapper is that door. It is granted to service_role and explicitly revoked from everyone
-- else: an erasure endpoint reachable with the anon key would be an account-deletion API for
-- strangers (see api/dsar.ts on Art. 12(6) identity verification).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.erase_subject(p_profile_id UUID)
RETURNS TABLE (inspections_anonymized INT, corrective_actions_unassigned INT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT a.inspections_anonymized, a.corrective_actions_unassigned
    FROM app.anonymize_profile(p_profile_id) AS a;
$$;

REVOKE ALL ON FUNCTION public.erase_subject(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erase_subject(UUID) TO service_role;

COMMENT ON FUNCTION public.erase_subject(UUID) IS
  'GDPR Art. 17 erasure of one person, keeping the NFPA 10 record. service_role only — call it '
  'after identity verification in the privacy request queue, never from a client.';
