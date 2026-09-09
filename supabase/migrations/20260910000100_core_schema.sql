-- EquipCert AI — core schema
--
-- This replaces the previous `001_production_schema.sql`, which could not be applied to a
-- fresh project: it only ever ran `ALTER TABLE inspections ADD COLUMN ...`, guarded by a
-- check against information_schema.columns. On an empty database that guard passes and the
-- ALTER then fails with "relation \"inspections\" does not exist". The table was created by
-- hand in the dashboard of the original project and never captured in source. When that
-- project was removed (DEF-007) the only definition of the app's central table went with it.
--
-- Everything the application actually reads or writes is now declared here.

-- ---------------------------------------------------------------------------
-- Private helper schema. Not exposed through PostgREST.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app;
REVOKE ALL ON SCHEMA app FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Plan limits.
--
-- The previous schema hardcoded "10 inspections per month" inside a PL/pgSQL trigger while
-- src/lib/plans.ts declared the same 10 as the single owner of plan limits (Rule 12). Two
-- copies of a number that changes with pricing is a drift waiting to happen, and the SQL
-- copy is the one nobody would remember to edit.
--
-- The table is structure only. Its rows are SEEDED by a generated migration derived from
-- plans.ts, so the TypeScript file stays the sole owner and the database follows it.
-- NULL means unlimited — SQL has no Infinity for integers.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.plan_limits (
  plan_id                TEXT PRIMARY KEY,
  max_users              INT CHECK (max_users > 0),
  max_inspections_month  INT CHECK (max_inspections_month > 0),
  max_ai_analyses_month  INT CHECK (max_ai_analyses_month > 0),
  allows_signatures      BOOLEAN NOT NULL DEFAULT false,
  generated_from         TEXT NOT NULL DEFAULT 'src/lib/plans.ts'
);

-- ---------------------------------------------------------------------------
-- Organizations — the tenant boundary.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organizations (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  slug                   TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
  logo_url               TEXT,
  plan                   TEXT NOT NULL DEFAULT 'free' REFERENCES public.plan_limits(plan_id),
  stripe_customer_id     TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  -- Data-retention window in months, per organization. NFPA 10 §7.2.2.6 sets the floor for
  -- monthly inspection records at 12 months; a customer may contractually need longer.
  retention_months       INT NOT NULL DEFAULT 12 CHECK (retention_months BETWEEN 12 AND 600),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Profiles — one per auth user, pinned to exactly one organization.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  full_name        TEXT NOT NULL CHECK (length(btrim(full_name)) BETWEEN 1 AND 200),
  role             TEXT NOT NULL DEFAULT 'technician' CHECK (role IN ('admin', 'manager', 'technician')),
  qualifications   TEXT,
  avatar_url       TEXT,
  esign_consent    BOOLEAN NOT NULL DEFAULT false,
  esign_consent_at TIMESTAMPTZ,
  -- Set when the subject exercises GDPR erasure. The row survives so inspection records
  -- keep a stable foreign key, but every identifying field is scrubbed. See
  -- app.anonymize_profile() in the compliance migration.
  anonymized_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A consent timestamp without consent, or consent without a timestamp, is not evidence
  -- of anything. ESIGN requires demonstrable intent, so keep the pair honest in the schema.
  CONSTRAINT esign_consent_is_evidenced
    CHECK ((esign_consent IS FALSE AND esign_consent_at IS NULL)
        OR (esign_consent IS TRUE  AND esign_consent_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_profiles_org  ON public.profiles(org_id);
CREATE INDEX IF NOT EXISTS idx_profiles_user ON public.profiles(user_id);

-- ---------------------------------------------------------------------------
-- Equipment registry.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.equipment (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  type                 TEXT,
  serial_number        TEXT,
  location             TEXT,
  status               TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'out_of_service', 'retired')),
  photo_url            TEXT,
  next_due_date        DATE,
  last_inspection_date TIMESTAMPTZ,
  metadata             JSONB NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A serial number is only unique within the customer that owns the asset.
  CONSTRAINT equipment_serial_unique_per_org UNIQUE (organization_id, serial_number)
);

CREATE INDEX IF NOT EXISTS idx_equipment_org    ON public.equipment(organization_id);
CREATE INDEX IF NOT EXISTS idx_equipment_due    ON public.equipment(organization_id, next_due_date)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_equipment_status ON public.equipment(organization_id, status);

-- ---------------------------------------------------------------------------
-- Inspections — the compliance record itself.
--
-- id stays BIGINT: corrective_actions.inspection_id already references it as BIGINT, and
-- the dashboard types it as `number`. Changing it would be a client-visible break for no
-- benefit.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inspections (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Kept nullable and ON DELETE SET NULL so erasing a person never destroys the record the
  -- customer is legally required to retain.
  inspector_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  equipment_id     UUID REFERENCES public.equipment(id) ON DELETE SET NULL,

  -- Denormalised names. These are a point-in-time snapshot of who inspected what: the
  -- equipment may later be renamed or the profile anonymised, and the record must still
  -- read correctly. inspector_name is scrubbed by the anonymisation routine.
  equipment_name   TEXT NOT NULL CHECK (length(btrim(equipment_name)) BETWEEN 1 AND 200),
  inspector_name   TEXT NOT NULL CHECK (length(btrim(inspector_name)) BETWEEN 1 AND 200),

  status           TEXT NOT NULL CHECK (status IN ('Safe', 'Action Required')),
  checklist_data   JSONB NOT NULL DEFAULT '[]',

  -- Object paths inside the private `evidence` bucket, NOT public URLs. See the storage
  -- migration: these files were previously world-readable.
  photo_url        TEXT,
  signature_url    TEXT,

  location_lat     NUMERIC(9, 6)  CHECK (location_lat  BETWEEN -90  AND 90),
  location_lng     NUMERIC(9, 6)  CHECK (location_lng  BETWEEN -180 AND 180),
  location_address TEXT,

  device_info      JSONB NOT NULL DEFAULT '{}',
  audit_trail      JSONB NOT NULL DEFAULT '[]',

  -- EU AI Act Article 50 provenance. The disclosure obligation is about the output, so the
  -- output carries its own provenance rather than the UI remembering to say so. Any report
  -- generated from this row can mark itself machine-readably without guessing.
  ai_assisted      BOOLEAN NOT NULL DEFAULT false,
  ai_provider      TEXT,
  ai_model         TEXT,
  ai_disclosed_at  TIMESTAMPTZ,

  -- Server-generated. A client-supplied inspection time is not evidence.
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- If it was AI-assisted we must know which system produced it, or the Article 50 record
  -- is unusable. If it was not, those columns must stay empty rather than drift.
  CONSTRAINT ai_provenance_is_complete
    CHECK ((ai_assisted IS FALSE AND ai_provider IS NULL AND ai_model IS NULL)
        OR (ai_assisted IS TRUE  AND ai_provider IS NOT NULL AND ai_model IS NOT NULL)),
  -- Latitude and longitude are meaningless one at a time.
  CONSTRAINT location_is_a_pair
    CHECK ((location_lat IS NULL) = (location_lng IS NULL))
);

-- The dashboard's default view is "this org, newest first". A composite DESC index serves
-- that ordering directly instead of sorting the tenant's whole history on every load.
CREATE INDEX IF NOT EXISTS idx_inspections_org_created
  ON public.inspections(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_equipment
  ON public.inspections(equipment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspections_inspector
  ON public.inspections(inspector_id);
-- The stats cards count failures per org; a partial index keeps that scan proportional to
-- the failures rather than to every inspection ever recorded.
CREATE INDEX IF NOT EXISTS idx_inspections_action_required
  ON public.inspections(organization_id, created_at DESC)
  WHERE status = 'Action Required';

-- ---------------------------------------------------------------------------
-- Corrective actions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.corrective_actions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  inspection_id        BIGINT NOT NULL REFERENCES public.inspections(id) ON DELETE CASCADE,
  checklist_item_id    TEXT,
  description          TEXT NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 5000),
  severity             TEXT NOT NULL DEFAULT 'minor'
                         CHECK (severity IN ('critical', 'major', 'minor')),
  assigned_to          UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  due_date             DATE,
  status               TEXT NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open', 'in_progress', 'resolved', 'overdue')),
  -- Evidence of the DEFECT, captured when the action is raised. Distinct from
  -- resolution_photo_url, which is evidence of the FIX. The form has always sent this and no
  -- schema ever had a column for it, so every corrective action with a photo failed to
  -- insert with "column photo_url does not exist" (DEF-023).
  defect_photo_url     TEXT,
  resolution_notes     TEXT,
  resolution_photo_url TEXT,
  resolved_at          TIMESTAMPTZ,
  resolved_by          UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT resolution_is_evidenced
    CHECK (status <> 'resolved' OR resolved_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_corrective_org        ON public.corrective_actions(organization_id);
CREATE INDEX IF NOT EXISTS idx_corrective_inspection ON public.corrective_actions(inspection_id);
-- "What is still outstanding for this org" is the query the dashboard actually runs.
CREATE INDEX IF NOT EXISTS idx_corrective_open
  ON public.corrective_actions(organization_id, due_date)
  WHERE status IN ('open', 'in_progress', 'overdue');

-- ---------------------------------------------------------------------------
-- Schedules.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.schedules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  equipment_id    UUID NOT NULL REFERENCES public.equipment(id) ON DELETE CASCADE,
  assigned_to     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  frequency       TEXT NOT NULL
                    CHECK (frequency IN ('daily', 'weekly', 'monthly', 'quarterly', 'annually')),
  next_due        DATE NOT NULL,
  last_completed  TIMESTAMPTZ,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schedules_org ON public.schedules(organization_id);
CREATE INDEX IF NOT EXISTS idx_schedules_due
  ON public.schedules(organization_id, next_due) WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- Notifications.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id     UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('inspection_due', 'corrective_assigned',
                                           'corrective_overdue', 'inspection_failed', 'system')),
  title      TEXT NOT NULL,
  body       TEXT,
  is_read    BOOLEAN NOT NULL DEFAULT false,
  action_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The bell only ever asks for this user's unread notifications, newest first.
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON public.notifications(user_id, created_at DESC) WHERE is_read = false;

-- ---------------------------------------------------------------------------
-- Audit log — append-only. Enforced by trigger in the RLS migration, not by convention.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- ON DELETE SET NULL, not the previous implicit RESTRICT: deleting an auth user must not
  -- be blocked by the audit trail, and the trail must not vanish with the user either.
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action          TEXT NOT NULL,
  resource_type   TEXT NOT NULL,
  resource_id     TEXT,
  details         JSONB NOT NULL DEFAULT '{}',
  ip_address      INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_org_created
  ON public.audit_log(organization_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- updated_at maintenance. A column nothing maintains is worse than no column.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  target TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY['organizations', 'profiles', 'equipment',
                                'corrective_actions', 'schedules']
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS touch_updated_at ON public.%I;
       CREATE TRIGGER touch_updated_at BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();',
      target, target);
  END LOOP;
END $$;
