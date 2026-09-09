-- EquipCert AI — compliance infrastructure
--
-- Covers three obligations that were previously only claimed in the privacy policy:
--
--   * GDPR Article 7(1) — being able to DEMONSTRATE consent, not merely collect it.
--   * GDPR Articles 15-22 and the US state equivalents — handling a data subject request
--     inside a statutory deadline, with an audit trail of who did what.
--   * GDPR Article 17 against NFPA 10 §7.2.2.6 — erasure of a person without destroying the
--     inspection record the customer is legally required to retain.
--
-- Nothing here is legal advice. It is the technical half of a compliance programme; the
-- organisational half (a DPA with each sub-processor, an Article 30 record, breach
-- procedures, a lawyer's review) lives in docs/compliance/ and is not code.

-- ---------------------------------------------------------------------------
-- Consent evidence.
--
-- Only for identified users. Cookie consent from an anonymous visitor is deliberately NOT
-- stored server-side: recording a row per visitor in order to prove you are not tracking
-- visitors is self-defeating, and it would create the very identifier the consent was about
-- avoiding. That consent lives in the visitor's own browser with a policy version stamp, and
-- the proof is the versioned banner configuration in source control.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consent_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- What was agreed to. `ai_processing` is the Article 50 acknowledgement that inspection
  -- photos are analysed by a third-party model.
  purpose         TEXT NOT NULL CHECK (purpose IN ('terms', 'privacy_policy',
                                                   'esign_disclosure', 'ai_processing',
                                                   'marketing_email')),
  -- Which version was agreed to. Consent to a document you have since rewritten is not
  -- consent to the current document.
  document_version TEXT NOT NULL,
  granted         BOOLEAN NOT NULL,
  -- Server-generated. A client-supplied consent time is not evidence of anything.
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Article 7(1) asks how consent was obtained, not just that it was.
  method          TEXT NOT NULL DEFAULT 'web_form'
                    CHECK (method IN ('web_form', 'mobile_app', 'api', 'import')),
  ip_address      INET,
  user_agent      TEXT
);

CREATE INDEX IF NOT EXISTS idx_consent_user
  ON public.consent_records(user_id, purpose, recorded_at DESC);

-- ---------------------------------------------------------------------------
-- Data subject requests.
--
-- One table for both regimes. The deadlines differ and the table stores the computed date
-- rather than making a human work it out under time pressure.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.data_subject_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  -- Nullable: a request may arrive from someone whose account is already gone, identified
  -- only by the address they used.
  subject_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  subject_email   TEXT NOT NULL CHECK (position('@' IN subject_email) > 1),

  request_type    TEXT NOT NULL CHECK (request_type IN (
                    'access',        -- GDPR Art 15 / CCPA right to know
                    'rectification', -- GDPR Art 16
                    'erasure',       -- GDPR Art 17 / CCPA right to delete
                    'portability',   -- GDPR Art 20
                    'restriction',   -- GDPR Art 18
                    'objection',     -- GDPR Art 21
                    'opt_out_sale'   -- US state opt-out of sale/sharing
                  )),
  -- Drives the deadline. GDPR is one month from receipt (Art 12(3)); the US state laws
  -- generally give 45 days.
  regime          TEXT NOT NULL DEFAULT 'gdpr' CHECK (regime IN ('gdpr', 'us_state')),

  status          TEXT NOT NULL DEFAULT 'received'
                    CHECK (status IN ('received', 'identity_pending', 'in_progress',
                                      'completed', 'refused', 'extended')),
  -- Article 12(6): you may not act on an unverified request. Recording HOW identity was
  -- established is the difference between diligence and handing data to an impersonator.
  verification_method TEXT,
  verified_at     TIMESTAMPTZ,

  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at          TIMESTAMPTZ NOT NULL,
  completed_at    TIMESTAMPTZ,
  -- A refusal must be reasoned and communicated (Art 12(4)).
  refusal_reason  TEXT,
  notes           TEXT,

  CONSTRAINT completion_is_dated
    CHECK (status <> 'completed' OR completed_at IS NOT NULL),
  CONSTRAINT refusal_is_reasoned
    CHECK (status <> 'refused' OR refusal_reason IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_dsr_open
  ON public.data_subject_requests(due_at)
  WHERE status NOT IN ('completed', 'refused');

/* Compute the statutory deadline on receipt so nobody has to remember which regime is which. */
CREATE OR REPLACE FUNCTION app.set_dsr_deadline()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.due_at IS NULL THEN
    NEW.due_at := NEW.received_at
      + CASE NEW.regime
          WHEN 'gdpr'     THEN INTERVAL '1 month'  -- GDPR Art 12(3)
          WHEN 'us_state' THEN INTERVAL '45 days'  -- CCPA and the state laws modelled on it
        END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_dsr_deadline ON public.data_subject_requests;
CREATE TRIGGER set_dsr_deadline
  BEFORE INSERT ON public.data_subject_requests
  FOR EACH ROW EXECUTE FUNCTION app.set_dsr_deadline();

-- due_at stays NOT NULL: a BEFORE ROW trigger fires before constraints are checked, so the
-- computed value is already in place by the time the constraint is evaluated. Relaxing the
-- column would let a request be filed with no deadline at all, which is the one thing the
-- table exists to prevent.

-- ---------------------------------------------------------------------------
-- Erasure.
--
-- The resolution of NFPA 10 against GDPR Article 17, as a function rather than a policy
-- document: the PERSON is erased, the RECORD survives.
--
-- What goes:      inspector name, qualifications, avatar, precise GPS, device fingerprint,
--                 and the auth user itself (which cascades the login and the email).
-- What stays:     the finding, the equipment, the checklist answers, the timestamp, the
--                 signature image, and the organisation. That is the compliance artefact the
--                 customer is legally required to hold, and it identifies nobody once the
--                 name is gone.
--
-- SECURITY DEFINER because it must write rows the caller's own policies would refuse — that
-- is the point of a controlled erasure path. It is granted to no one: it runs as the service
-- role from the DSAR handler, so an ordinary session cannot invoke it.
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

  -- 1. The inspection records. This is the write the immutability trigger explicitly permits,
  --    and only in exactly this shape.
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

  -- 3. The profile itself. The row survives so foreign keys stay valid, holding nothing.
  UPDATE public.profiles
     SET full_name      = v_label,
         qualifications = NULL,
         avatar_url     = NULL,
         anonymized_at  = now()
   WHERE id = p_profile_id;

  -- 4. The audit trail records that an action happened, not who the person was.
  UPDATE public.audit_log
     SET user_id = NULL,
         details = details - 'email' - 'full_name' - 'ip_address'
   WHERE user_id = v_user_id;

  -- 5. Finally the login. Deleting the auth user removes the email address, the password
  --    hash and every session. It is last because the steps above key off it.
  DELETE FROM auth.users WHERE id = v_user_id;

  inspections_anonymized        := v_inspections;
  corrective_actions_unassigned := v_corrective;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION app.anonymize_profile(UUID) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Portability / access export.
--
-- GDPR Article 20 wants a structured, commonly used, machine-readable form. One function
-- assembling it beats a handler stitching six queries together and forgetting one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.export_subject_data(p_user_id UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'exported_at', now(),
    'format_note', 'GDPR Art. 20 portable export. Timestamps are UTC ISO-8601.',
    'profile', (
      SELECT to_jsonb(p) - 'id' - 'org_id'
      FROM public.profiles p WHERE p.user_id = p_user_id
    ),
    'consent_history', COALESCE((
      SELECT jsonb_agg(to_jsonb(c) - 'id' - 'user_id' - 'organization_id' ORDER BY c.recorded_at)
      FROM public.consent_records c WHERE c.user_id = p_user_id
    ), '[]'::jsonb),
    'inspections', COALESCE((
      SELECT jsonb_agg(to_jsonb(i) - 'organization_id' ORDER BY i.created_at)
      FROM public.inspections i
      JOIN public.profiles p ON p.id = i.inspector_id
      WHERE p.user_id = p_user_id
    ), '[]'::jsonb),
    'notifications', COALESCE((
      SELECT jsonb_agg(to_jsonb(n) - 'user_id' - 'org_id' ORDER BY n.created_at)
      FROM public.notifications n WHERE n.user_id = p_user_id
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION app.export_subject_data(UUID) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Retention.
--
-- GDPR storage limitation says do not keep personal data longer than necessary; NFPA 10
-- §7.2.2.6 says keep the monthly inspection record at least 12 months. Both are satisfied by
-- keeping the RECORD for the organisation's retention window and stripping the PERSONAL
-- columns from anything older, rather than deleting either the whole row or nothing.
--
-- Returns the count instead of running on a schedule: this project has no pg_cron on the free
-- plan, so it is invoked by a GitHub Actions schedule and the count is what gets reported.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.apply_retention_policy()
RETURNS TABLE (organization_id UUID, records_stripped INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  org RECORD;
  n   INT;
BEGIN
  FOR org IN SELECT o.id, o.retention_months FROM public.organizations o LOOP
    UPDATE public.inspections i
       SET inspector_name = app.redacted_subject_label(),
           inspector_id   = NULL,
           location_lat   = NULL,
           location_lng   = NULL,
           device_info    = '{}'::jsonb
     WHERE i.organization_id = org.id
       AND i.created_at < now() - make_interval(months => org.retention_months)
       AND i.inspector_id IS NOT NULL;
    GET DIAGNOSTICS n = ROW_COUNT;

    organization_id  := org.id;
    records_stripped := n;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION app.apply_retention_policy() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS for the two new tables.
-- ---------------------------------------------------------------------------
ALTER TABLE public.consent_records       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consent_records       FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.data_subject_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_subject_requests FORCE  ROW LEVEL SECURITY;

-- A person may read their own consent history; an admin may read the organisation's, because
-- proving consent is an accountability duty that falls on the controller.
CREATE POLICY consent_select_self_or_admin ON public.consent_records
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (organization_id = (SELECT app.current_org_id()) AND (SELECT app.is_admin()))
  );

CREATE POLICY consent_insert_self ON public.consent_records
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid())
              AND organization_id = (SELECT app.current_org_id()));

-- Consent evidence is append-only. Withdrawal is a NEW row with granted = false, never an
-- edit of the old one; otherwise the history that proves compliance can be rewritten.
CREATE OR REPLACE FUNCTION app.consent_is_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION
    'Consent records are append-only; record a withdrawal as a new row instead of a %.', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS consent_append_only ON public.consent_records;
CREATE TRIGGER consent_append_only
  BEFORE UPDATE OR DELETE ON public.consent_records
  FOR EACH ROW EXECUTE FUNCTION app.consent_is_append_only();

-- Only administrators see the request queue. It contains other people's email addresses.
CREATE POLICY dsr_select_admin ON public.data_subject_requests
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT app.current_org_id()) AND (SELECT app.is_admin()));

CREATE POLICY dsr_update_admin ON public.data_subject_requests
  FOR UPDATE TO authenticated
  USING (organization_id = (SELECT app.current_org_id()) AND (SELECT app.is_admin()))
  WITH CHECK (organization_id = (SELECT app.current_org_id()));

-- Requests are lodged by the serverless handler running as the service role, because the
-- requester frequently has no account — or is asking precisely to have theirs removed.
