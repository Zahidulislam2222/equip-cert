-- EquipCert AI — promote CHECK-constrained text columns to real enum types
--
-- WHY
--
-- Every closed domain in this schema was modelled as `TEXT` plus
-- `CHECK (col IN ('a','b','c'))`. That enforces the values, but it does not DESCRIBE them:
-- to Postgres the column is still text, so `supabase gen types typescript` emits `string`.
-- The generated client then types `equipment.status` as `string` while the UI declares
-- `'active' | 'out_of_service' | 'retired'`, and the two have to be reconciled with a cast at
-- every call site. A cast is a place where the compiler stops checking, which is precisely
-- what let a whole column name go wrong unnoticed in DEF-023.
--
-- A CHECK constraint listing three literals IS an enum. Declaring it as one makes the domain
-- travel: Postgres enforces it, the generator emits a union, and the UI's own type comes from
-- the database instead of being retyped by hand next to it.
--
-- NOT converted: `organizations.plan`. It is a foreign key into `plan_limits`, whose rows are
-- generated from src/lib/plans.ts. Referential integrity against a table that the pricing
-- source of truth writes is stronger than an enum, and the TypeScript union already exists
-- there as `PlanId`.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE public.user_role AS ENUM ('admin', 'manager', 'technician');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'equipment_status') THEN
    CREATE TYPE public.equipment_status AS ENUM ('active', 'out_of_service', 'retired');
  END IF;
  -- Labels keep their existing spelling. The client writes and renders these exact strings;
  -- renaming them to snake_case would be a data and UI migration for a cosmetic gain.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inspection_status') THEN
    CREATE TYPE public.inspection_status AS ENUM ('Safe', 'Action Required');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'corrective_severity') THEN
    CREATE TYPE public.corrective_severity AS ENUM ('critical', 'major', 'minor');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'corrective_status') THEN
    CREATE TYPE public.corrective_status AS ENUM ('open', 'in_progress', 'resolved', 'overdue');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'schedule_frequency') THEN
    CREATE TYPE public.schedule_frequency AS ENUM
      ('daily', 'weekly', 'monthly', 'quarterly', 'annually');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
    CREATE TYPE public.notification_type AS ENUM
      ('inspection_due', 'corrective_assigned', 'corrective_overdue',
       'inspection_failed', 'system');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'consent_purpose') THEN
    CREATE TYPE public.consent_purpose AS ENUM
      ('terms', 'privacy_policy', 'esign_disclosure', 'ai_processing', 'marketing_email');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'consent_method') THEN
    CREATE TYPE public.consent_method AS ENUM ('web_form', 'mobile_app', 'api', 'import');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dsr_type') THEN
    CREATE TYPE public.dsr_type AS ENUM
      ('access', 'rectification', 'erasure', 'portability',
       'restriction', 'objection', 'opt_out_sale');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dsr_regime') THEN
    CREATE TYPE public.dsr_regime AS ENUM ('gdpr', 'us_state');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dsr_status') THEN
    CREATE TYPE public.dsr_status AS ENUM
      ('received', 'identity_pending', 'in_progress', 'completed', 'refused', 'extended');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Conversion
--
-- The CHECK constraint and the DEFAULT both have to go first: the constraint compares the
-- column to text literals, and the default is a text expression. Both are restored afterwards
-- as the enum, except the CHECKs, which the enum now subsumes entirely — keeping them would
-- be the same rule written twice, which is the failure mode this project keeps finding.
-- ---------------------------------------------------------------------------

-- profiles.role
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ALTER COLUMN role DROP DEFAULT;
ALTER TABLE public.profiles
  ALTER COLUMN role TYPE public.user_role USING role::text::public.user_role;
ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'technician'::public.user_role;

-- equipment.status.
--
-- Any PARTIAL index whose predicate mentions the column has to be dropped first. Postgres
-- rebuilds dependent indexes during the type change, and a predicate written as
-- `status = 'active'` was resolved against text when the index was created — after the change
-- it becomes `equipment_status = text`, for which no operator exists, and the ALTER fails
-- with 42883. Every partial index over a converted column in this migration is treated the
-- same way.
DROP INDEX IF EXISTS public.idx_equipment_due;
ALTER TABLE public.equipment DROP CONSTRAINT IF EXISTS equipment_status_check;
ALTER TABLE public.equipment ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.equipment
  ALTER COLUMN status TYPE public.equipment_status USING status::text::public.equipment_status;
ALTER TABLE public.equipment ALTER COLUMN status SET DEFAULT 'active'::public.equipment_status;
CREATE INDEX idx_equipment_due
  ON public.equipment(organization_id, next_due_date)
  WHERE status = 'active';

-- inspections.status. The partial index on 'Action Required' depends on the column, so it is
-- dropped and rebuilt around the type change.
DROP INDEX IF EXISTS public.idx_inspections_action_required;
ALTER TABLE public.inspections DROP CONSTRAINT IF EXISTS inspections_status_check;
ALTER TABLE public.inspections
  ALTER COLUMN status TYPE public.inspection_status USING status::text::public.inspection_status;
CREATE INDEX idx_inspections_action_required
  ON public.inspections(organization_id, created_at DESC)
  WHERE status = 'Action Required';

-- corrective_actions.severity and .status
DROP INDEX IF EXISTS public.idx_corrective_open;
ALTER TABLE public.corrective_actions DROP CONSTRAINT IF EXISTS corrective_actions_severity_check;
ALTER TABLE public.corrective_actions ALTER COLUMN severity DROP DEFAULT;
ALTER TABLE public.corrective_actions
  ALTER COLUMN severity TYPE public.corrective_severity
  USING severity::text::public.corrective_severity;
ALTER TABLE public.corrective_actions
  ALTER COLUMN severity SET DEFAULT 'minor'::public.corrective_severity;

-- Named CHECK constraints that mention the column are the same hazard as partial indexes:
-- `status <> 'resolved'` was resolved against text and becomes `corrective_status <> text`.
ALTER TABLE public.corrective_actions DROP CONSTRAINT IF EXISTS corrective_actions_status_check;
ALTER TABLE public.corrective_actions DROP CONSTRAINT IF EXISTS resolution_is_evidenced;
ALTER TABLE public.corrective_actions ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.corrective_actions
  ALTER COLUMN status TYPE public.corrective_status
  USING status::text::public.corrective_status;
ALTER TABLE public.corrective_actions
  ALTER COLUMN status SET DEFAULT 'open'::public.corrective_status;
CREATE INDEX idx_corrective_open
  ON public.corrective_actions(organization_id, due_date)
  WHERE status IN ('open', 'in_progress', 'overdue');
ALTER TABLE public.corrective_actions ADD CONSTRAINT resolution_is_evidenced
  CHECK (status <> 'resolved'::public.corrective_status OR resolved_at IS NOT NULL);

-- schedules.frequency
ALTER TABLE public.schedules DROP CONSTRAINT IF EXISTS schedules_frequency_check;
ALTER TABLE public.schedules
  ALTER COLUMN frequency TYPE public.schedule_frequency
  USING frequency::text::public.schedule_frequency;

-- notifications.type
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ALTER COLUMN type TYPE public.notification_type
  USING type::text::public.notification_type;

-- consent_records.purpose and .method
ALTER TABLE public.consent_records DROP CONSTRAINT IF EXISTS consent_records_purpose_check;
ALTER TABLE public.consent_records
  ALTER COLUMN purpose TYPE public.consent_purpose
  USING purpose::text::public.consent_purpose;

ALTER TABLE public.consent_records DROP CONSTRAINT IF EXISTS consent_records_method_check;
ALTER TABLE public.consent_records ALTER COLUMN method DROP DEFAULT;
ALTER TABLE public.consent_records
  ALTER COLUMN method TYPE public.consent_method
  USING method::text::public.consent_method;
ALTER TABLE public.consent_records
  ALTER COLUMN method SET DEFAULT 'web_form'::public.consent_method;

-- data_subject_requests.request_type, .regime and .status
DROP INDEX IF EXISTS public.idx_dsr_open;
ALTER TABLE public.data_subject_requests
  DROP CONSTRAINT IF EXISTS data_subject_requests_request_type_check;
ALTER TABLE public.data_subject_requests
  ALTER COLUMN request_type TYPE public.dsr_type USING request_type::text::public.dsr_type;

ALTER TABLE public.data_subject_requests DROP CONSTRAINT IF EXISTS data_subject_requests_regime_check;
ALTER TABLE public.data_subject_requests ALTER COLUMN regime DROP DEFAULT;
ALTER TABLE public.data_subject_requests
  ALTER COLUMN regime TYPE public.dsr_regime USING regime::text::public.dsr_regime;
ALTER TABLE public.data_subject_requests
  ALTER COLUMN regime SET DEFAULT 'gdpr'::public.dsr_regime;

ALTER TABLE public.data_subject_requests DROP CONSTRAINT IF EXISTS data_subject_requests_status_check;
ALTER TABLE public.data_subject_requests DROP CONSTRAINT IF EXISTS completion_is_dated;
ALTER TABLE public.data_subject_requests DROP CONSTRAINT IF EXISTS refusal_is_reasoned;
ALTER TABLE public.data_subject_requests ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.data_subject_requests
  ALTER COLUMN status TYPE public.dsr_status USING status::text::public.dsr_status;
ALTER TABLE public.data_subject_requests
  ALTER COLUMN status SET DEFAULT 'received'::public.dsr_status;
CREATE INDEX idx_dsr_open
  ON public.data_subject_requests(due_at)
  WHERE status NOT IN ('completed', 'refused');
ALTER TABLE public.data_subject_requests ADD CONSTRAINT completion_is_dated
  CHECK (status <> 'completed'::public.dsr_status OR completed_at IS NOT NULL);
ALTER TABLE public.data_subject_requests ADD CONSTRAINT refusal_is_reasoned
  CHECK (status <> 'refused'::public.dsr_status OR refusal_reason IS NOT NULL);

-- ---------------------------------------------------------------------------
-- The deadline trigger compares NEW.regime against text literals in a CASE. Postgres will not
-- implicitly compare an enum to an unknown literal inside CASE, so the comparison is made
-- explicit rather than left to work by accident.
-- ---------------------------------------------------------------------------
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
          WHEN 'gdpr'::public.dsr_regime     THEN INTERVAL '1 month'  -- GDPR Art 12(3)
          WHEN 'us_state'::public.dsr_regime THEN INTERVAL '45 days'  -- CCPA and its imitators
        END;
  END IF;
  RETURN NEW;
END;
$$;

-- app.current_role() must now return the enum, so that the role comparisons below are
-- enum-to-enum rather than relying on an implicit cast that Postgres will not always make.
-- CREATE OR REPLACE cannot change a return type, hence the drop.
--
-- Deliberately NOT `CASCADE`: policies depend on app.is_admin() and app.is_manager(), and a
-- cascade that quietly dropped a security policy would be the worst possible outcome of a
-- typing improvement. If something does depend on this function, the migration should fail
-- loudly and be read by a person.
DROP FUNCTION IF EXISTS app.current_role();
CREATE OR REPLACE FUNCTION app.current_role()
RETURNS public.user_role
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT p.role FROM public.profiles p WHERE p.user_id = (SELECT auth.uid());
$$;

CREATE OR REPLACE FUNCTION app.is_manager()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(app.current_role() IN ('admin'::public.user_role, 'manager'::public.user_role), false);
$$;

CREATE OR REPLACE FUNCTION app.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(app.current_role() = 'admin'::public.user_role, false);
$$;

GRANT EXECUTE ON FUNCTION app.current_role(), app.is_manager(), app.is_admin() TO authenticated;
