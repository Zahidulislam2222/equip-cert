-- EquipCert AI — tenancy hardening, invitations, e-sign consent evidence (2026-11-25, session 14)
--
-- Three defects, reproduced on the real engine before this file was written
-- (tests/repro_def076_077.mjs, e2e/local/tenancy.test.mjs):
--
--   DEF-076  `profiles_insert_self` checked only `user_id = auth.uid()`. Any signed-in account with
--            no profile could INSERT one into ANY organisation, with role 'admin'. The column guard
--            trigger is BEFORE UPDATE, so nothing looked at an INSERT at all.
--   DEF-077  `organizations_update_admin` let an admin PATCH their own `plan`, `stripe_customer_id`
--            and `stripe_subscription_id`. RLS decides rows, never columns, so "enterprise for
--            free" was one request.
--   DEF-074  Neither client recorded e-sign consent, and the column pair would have accepted a
--            client-chosen timestamp — which is not evidence of anything.
--
-- And one long-standing gap: signup created the organisation and the profile in two client calls
-- (DEF-045), so a dropped connection between them orphaned a tenant. Provisioning is now ONE
-- transaction inside a SECURITY DEFINER function, and joining an existing tenant is only possible
-- through a single-use invitation issued by that tenant's admin.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- 1. No direct inserts of tenants or members (DEF-076).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS organizations_insert_during_signup ON public.organizations;
DROP POLICY IF EXISTS profiles_insert_self ON public.profiles;

-- ---------------------------------------------------------------------------
-- 2. Billing columns change only through verified billing events (DEF-077).
--
-- `auth.role()` is the role in the request's JWT: 'authenticated' for a browser or the mobile app,
-- 'service_role' for the Stripe webhook handler, NULL for a migration or the SQL editor. Only the
-- first is refused — the guard is about who is asking, not about which statement.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.guard_organization_billing()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE((SELECT auth.role()), '') IN ('authenticated', 'anon')
     AND (NEW.plan IS DISTINCT FROM OLD.plan
          OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
          OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id) THEN
    RAISE EXCEPTION 'The plan and billing identifiers change only through verified billing events.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_organization_billing ON public.organizations;
CREATE TRIGGER guard_organization_billing
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION app.guard_organization_billing();

-- ---------------------------------------------------------------------------
-- 3. Seat limit, enforced where it cannot be skipped.
--
-- `plan_limits.max_users` existed (seeded from src/lib/plans.ts) and nothing read it. The
-- organisation row is locked FOR UPDATE so two invitations accepted at the same moment cannot
-- both see "one seat left". Erased members do not hold a seat.
--
-- Like the billing guard, the limit binds requests made by a customer's own session ('anon' /
-- 'authenticated' in the JWT — which includes provision_account and accept_invite, because a
-- SECURITY DEFINER function keeps the caller's JWT). A support operation or test fixture run with
-- the service role is a different actor and may exceed it deliberately.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.enforce_member_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_max   INT;
  v_count INT;
BEGIN
  IF COALESCE((SELECT auth.role()), '') NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  SELECT pl.max_users INTO v_max
    FROM public.organizations o
    JOIN public.plan_limits pl ON pl.plan_id = o.plan
   WHERE o.id = NEW.org_id
     FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown organization %', NEW.org_id USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_max IS NOT NULL THEN
    SELECT count(*) INTO v_count
      FROM public.profiles p
     WHERE p.org_id = NEW.org_id AND p.anonymized_at IS NULL;
    IF v_count >= v_max THEN
      RAISE EXCEPTION 'Plan limit reached: % user(s). Upgrade to add members.', v_max
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app.enforce_member_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_member_limit ON public.profiles;
CREATE TRIGGER enforce_member_limit
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION app.enforce_member_limit();

-- ---------------------------------------------------------------------------
-- 4. E-sign consent evidence (DEF-074).
--
-- The version names the consent WORDING the person saw (it lives in both clients, kept identical).
-- The timestamp is always the server's: whatever a client sends for esign_consent_at is
-- overwritten when consent is given, and any other change to it is refused.
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS esign_consent_version TEXT
    CHECK (esign_consent_version IS NULL OR length(btrim(esign_consent_version)) BETWEEN 1 AND 40);

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

  -- Erasure (anonymized_at) is a server act: app.anonymize_profile() under the service role. A
  -- member who could set it on their own row would also free a seat (enforce_member_limit and
  -- seats_committed count only non-anonymised profiles) without leaving the organisation.
  IF NEW.anonymized_at IS DISTINCT FROM OLD.anonymized_at
     AND COALESCE((SELECT auth.role()), '') IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'Only the erasure process may anonymise a profile.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Consent is personal. profiles_update_self_or_admin lets an admin edit a member's row, so
  -- without this an admin could record "consent given" for a technician who never saw the
  -- wording — evidence of nothing.
  IF (NEW.esign_consent IS DISTINCT FROM OLD.esign_consent
      OR NEW.esign_consent_version IS DISTINCT FROM OLD.esign_consent_version
      OR NEW.esign_consent_at IS DISTINCT FROM OLD.esign_consent_at)
     AND COALESCE((SELECT auth.role()), '') IN ('authenticated', 'anon')
     AND OLD.user_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'E-signature consent can only be given by the person signing.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ESIGN evidence is written once, when consent is actually given.
  IF OLD.esign_consent AND NOT NEW.esign_consent THEN
    RAISE EXCEPTION 'Recorded e-signature consent cannot be withdrawn by editing the profile.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.esign_consent
     AND (NOT OLD.esign_consent
          OR NEW.esign_consent_version IS DISTINCT FROM OLD.esign_consent_version) THEN
    -- Consent given now (first time, or to a newer wording): the server supplies the time.
    IF NEW.esign_consent_version IS NULL THEN
      RAISE EXCEPTION 'E-signature consent must name the wording version that was shown.'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.esign_consent_at := now();
  ELSIF NEW.esign_consent_at IS DISTINCT FROM OLD.esign_consent_at
        OR NEW.esign_consent_version IS DISTINCT FROM OLD.esign_consent_version THEN
    RAISE EXCEPTION 'E-signature consent evidence is written by the server, once.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

-- SECURITY INVOKER: it is the caller updating their own row under profiles_update_self_or_admin,
-- and the guard above supplies the timestamp. Nothing here needs elevated rights.
CREATE OR REPLACE FUNCTION public.record_esign_consent(p_version TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_at TIMESTAMPTZ;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Not signed in.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.profiles
     SET esign_consent = true,
         esign_consent_version = btrim(p_version)
   WHERE user_id = (SELECT auth.uid())
  RETURNING esign_consent_at INTO v_at;
  IF v_at IS NULL THEN
    RAISE EXCEPTION 'No profile for this account.' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN v_at;
END;
$$;

REVOKE ALL ON FUNCTION public.record_esign_consent(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_esign_consent(TEXT) TO authenticated;

-- A signed inspection must be filed by the person who signed it, and that person must have
-- consent on record. Client ordering alone was not enough: an older app build, or a direct
-- PostgREST call, could insert a signed record with no consent, or name a colleague as the
-- inspector (inspections_insert_member checks only the organisation). Customer sessions only —
-- support operations and fixtures under the service role are a different actor.
CREATE OR REPLACE FUNCTION app.require_consenting_signer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
BEGIN
  IF NEW.signature_url IS NULL
     OR COALESCE((SELECT auth.role()), '') NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE user_id = (SELECT auth.uid());
  IF NOT FOUND OR NEW.inspector_id IS DISTINCT FROM v_profile.id THEN
    RAISE EXCEPTION 'A signed inspection must be filed by the inspector who signed it.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT v_profile.esign_consent OR v_profile.esign_consent_version IS NULL THEN
    RAISE EXCEPTION 'Agree to sign electronically before filing a signed inspection.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app.require_consenting_signer() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS require_consenting_signer ON public.inspections;
CREATE TRIGGER require_consenting_signer
  BEFORE INSERT ON public.inspections
  FOR EACH ROW EXECUTE FUNCTION app.require_consenting_signer();

-- ---------------------------------------------------------------------------
-- 5. Provisioning a new tenant — one transaction (DEF-045, DEF-076).
--
-- Reads the organisation and person names from the account's own signup metadata, so the caller
-- supplies no arguments at all: there is nothing to tamper with. Idempotent — an account that
-- already has a profile gets its organisation back, which is what lets both clients call this
-- after every sign-in and heal an account stranded by the old two-call signup.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provision_account()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid       UUID := (SELECT auth.uid());
  v_org       UUID;
  v_meta      JSONB;
  v_email     TEXT;
  v_org_name  TEXT;
  v_full_name TEXT;
  v_base      TEXT;
  v_slug      TEXT;
  v_attempt   INT := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT p.org_id INTO v_org FROM public.profiles p WHERE p.user_id = v_uid;
  IF FOUND THEN
    RETURN v_org;
  END IF;

  SELECT u.raw_user_meta_data, u.email INTO v_meta, v_email FROM auth.users u WHERE u.id = v_uid;
  v_org_name := left(btrim(COALESCE(v_meta ->> 'org_name', '')), 200);
  IF v_org_name = '' THEN
    -- An invited person has no organisation name. Minting an empty tenant here would silently
    -- fork them off from the team that invited them.
    RAISE EXCEPTION 'This account has no organisation yet. Join with an invitation link.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_full_name := left(COALESCE(NULLIF(btrim(v_meta ->> 'full_name'), ''), v_email, 'Account owner'), 200);

  -- Slug: lowercase alphanumerics and single hyphens, no leading/trailing hyphen, <= 63 chars.
  v_base := btrim(regexp_replace(lower(v_org_name), '[^a-z0-9]+', '-', 'g'), '-');
  v_base := btrim(left(v_base, 56), '-');
  IF v_base = '' THEN
    v_base := 'org';
  END IF;

  LOOP
    v_slug := CASE WHEN v_attempt = 0 THEN v_base
                   ELSE v_base || '-' || substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6) END;
    BEGIN
      INSERT INTO public.organizations (name, slug) VALUES (v_org_name, v_slug) RETURNING id INTO v_org;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_attempt := v_attempt + 1;
      IF v_attempt > 5 THEN
        RAISE;
      END IF;
    END;
  END LOOP;

  INSERT INTO public.profiles (user_id, org_id, full_name, role)
  VALUES (v_uid, v_org, v_full_name, 'admin');

  RETURN v_org;
END;
$$;

REVOKE ALL ON FUNCTION public.provision_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provision_account() TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Invitations.
--
-- The link IS the credential, so the table stores only a SHA-256 of a 192-bit random token; the
-- token itself is returned once, to the admin who created it. No email address is stored — the
-- admin shares the link however they like, which keeps personal data out of this table entirely.
-- Single use, time-limited, revocable; the invitee never chooses their own role.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organization_invites (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role            public.user_role NOT NULL CHECK (role <> 'admin'),
  token_hash      BYTEA NOT NULL UNIQUE,
  created_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  accepted_at     TIMESTAMPTZ,
  accepted_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  revoked_at      TIMESTAMPTZ,
  CONSTRAINT invite_has_one_outcome CHECK (accepted_at IS NULL OR revoked_at IS NULL),
  CONSTRAINT invite_expires_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_invites_org ON public.organization_invites(organization_id, created_at DESC);

ALTER TABLE public.organization_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_invites FORCE  ROW LEVEL SECURITY;

-- Column-level read: managers see every column EXCEPT the hash. Writes only through the functions.
REVOKE ALL ON TABLE public.organization_invites FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, organization_id, role, created_by, created_at, expires_at,
              accepted_at, accepted_by, revoked_at)
  ON public.organization_invites TO authenticated;

DROP POLICY IF EXISTS invites_select_manager ON public.organization_invites;
CREATE POLICY invites_select_manager ON public.organization_invites
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT app.current_org_id()) AND (SELECT app.is_manager()));

/* Seats in use: active members plus invitations still open. */
CREATE OR REPLACE FUNCTION app.seats_committed(p_org UUID)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (SELECT count(*) FROM public.profiles p WHERE p.org_id = p_org AND p.anonymized_at IS NULL)::int
       + (SELECT count(*) FROM public.organization_invites i
           WHERE i.organization_id = p_org AND i.accepted_at IS NULL
             AND i.revoked_at IS NULL AND i.expires_at > now())::int;
$$;

REVOKE ALL ON FUNCTION app.seats_committed(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_invite(p_role public.user_role, p_valid_hours INT)
RETURNS TABLE (invite_id UUID, token TEXT, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org     UUID := app.current_org_id();
  v_profile UUID;
  v_max     INT;
  v_token   TEXT;
  v_id      UUID;
  v_expires TIMESTAMPTZ;
BEGIN
  IF v_org IS NULL OR NOT app.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can invite members.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_role = 'admin' THEN
    RAISE EXCEPTION 'Invite as manager or technician; promote afterwards if needed.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- The validity window is configuration (src/lib/config.ts); the database only bounds it.
  IF p_valid_hours IS NULL OR p_valid_hours NOT BETWEEN 1 AND 720 THEN
    RAISE EXCEPTION 'Invitation validity must be between 1 and 720 hours.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT pl.max_users INTO v_max
    FROM public.organizations o JOIN public.plan_limits pl ON pl.plan_id = o.plan
   WHERE o.id = v_org
     FOR UPDATE OF o;
  IF v_max IS NOT NULL AND app.seats_committed(v_org) >= v_max THEN
    RAISE EXCEPTION 'Plan limit reached: % user(s). Upgrade to add members.', v_max
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT p.id INTO v_profile FROM public.profiles p WHERE p.user_id = (SELECT auth.uid());

  -- 24 random bytes, base64url without padding: 32 characters, 192 bits.
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_'), '=');
  v_expires := now() + make_interval(hours => p_valid_hours);

  INSERT INTO public.organization_invites (organization_id, role, token_hash, created_by, expires_at)
  VALUES (v_org, p_role, extensions.digest(v_token, 'sha256'), v_profile, v_expires)
  RETURNING id INTO v_id;

  INSERT INTO public.audit_log (organization_id, user_id, action, resource_type, resource_id, details)
  VALUES (v_org, (SELECT auth.uid()), 'member.invited', 'organization_invites', v_id::text,
          jsonb_build_object('role', p_role, 'expires_at', v_expires, 'actor_role', auth.role()));

  RETURN QUERY SELECT v_id, v_token, v_expires;
END;
$$;

REVOKE ALL ON FUNCTION public.create_invite(public.user_role, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_invite(public.user_role, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_invite(p_invite_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org UUID := app.current_org_id();
BEGIN
  IF v_org IS NULL OR NOT app.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can revoke invitations.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.organization_invites
     SET revoked_at = now()
   WHERE id = p_invite_id AND organization_id = v_org
     AND accepted_at IS NULL AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No open invitation with that id.' USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO public.audit_log (organization_id, user_id, action, resource_type, resource_id, details)
  VALUES (v_org, (SELECT auth.uid()), 'member.invite_revoked', 'organization_invites', p_invite_id::text,
          jsonb_build_object('actor_role', auth.role()));
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_invite(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_invite(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_invite(p_token TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid       UUID := (SELECT auth.uid());
  v_invite    public.organization_invites%ROWTYPE;
  v_meta      JSONB;
  v_email     TEXT;
  v_full_name TEXT;
  v_profile   UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = v_uid) THEN
    RAISE EXCEPTION 'This account already belongs to an organisation.' USING ERRCODE = 'unique_violation';
  END IF;

  SELECT i.* INTO v_invite
    FROM public.organization_invites i
   WHERE i.token_hash = extensions.digest(COALESCE(p_token, ''), 'sha256')
     FOR UPDATE;

  -- One message for unknown, expired, revoked and used: the response must not tell a guesser
  -- which of those it hit.
  IF NOT FOUND OR v_invite.accepted_at IS NOT NULL OR v_invite.revoked_at IS NOT NULL
     OR v_invite.expires_at <= now() THEN
    RAISE EXCEPTION 'This invitation is invalid or has expired.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT u.raw_user_meta_data, u.email INTO v_meta, v_email FROM auth.users u WHERE u.id = v_uid;
  v_full_name := left(COALESCE(NULLIF(btrim(v_meta ->> 'full_name'), ''), v_email, 'Team member'), 200);

  -- enforce_member_limit runs here; the invitation's own seat is released in the same statement
  -- order (accepted_at is set after), so the count it sees includes this person once.
  INSERT INTO public.profiles (user_id, org_id, full_name, role)
  VALUES (v_uid, v_invite.organization_id, v_full_name, v_invite.role)
  RETURNING id INTO v_profile;

  UPDATE public.organization_invites
     SET accepted_at = now(), accepted_by = v_profile
   WHERE id = v_invite.id;

  RETURN v_invite.organization_id;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_invite(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_invite(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Billing events — Stripe webhook idempotency.
--
-- Stripe delivers at least once. The handler inserts the event id first; a duplicate delivery hits
-- the primary key and is acknowledged without being applied twice. Service role only: no policy
-- grants anything to anon or authenticated.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_events (
  event_id        TEXT PRIMARY KEY CHECK (event_id ~ '^evt_[A-Za-z0-9]+$'),
  event_type      TEXT NOT NULL CHECK (length(event_type) BETWEEN 1 AND 100),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.billing_events FROM PUBLIC, anon, authenticated;

-- Managers may see their own organisation's billing history; nobody but the server writes it.
DROP POLICY IF EXISTS billing_events_select_manager ON public.billing_events;
CREATE POLICY billing_events_select_manager ON public.billing_events
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT app.current_org_id()) AND (SELECT app.is_manager()));
GRANT SELECT ON public.billing_events TO authenticated;
