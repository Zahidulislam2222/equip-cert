-- Data subject request intake.
--
-- THE HOLE THIS CLOSES
--
-- `data_subject_requests` shipped with a SELECT policy and an UPDATE policy for admins, and no
-- INSERT policy at all. Under FORCE ROW LEVEL SECURITY that means nobody could file a request —
-- not an anonymous data subject, not a signed-in user, not an admin. A table that records the
-- statutory clock but cannot be written to is a compliance artefact, not a compliance control.
--
-- GDPR Art. 12(2) requires the controller to *facilitate* the exercise of data subject rights.
-- A right you cannot exercise has not been facilitated.
--
-- WHY THE FIX IS NOT "ADD AN INSERT POLICY FOR anon"
--
-- Two reasons, and both matter more than the convenience.
--
--   1. The people most likely to file an erasure request are exactly the people who no longer
--      have an account. There is no JWT to write a policy against. `anon` INSERT would be the
--      only option, and `anon` INSERT on a table means an unauthenticated internet caller can
--      write rows into your database at whatever rate they like.
--
--   2. `organization_id` must never come from the request body. A caller who can choose it can
--      file a request against another tenant, and every admin in that tenant then sees an
--      attacker-controlled email address and free-text notes in their privacy queue. That is
--      OWASP API1 (Broken Object Level Authorization) written into a compliance workflow.
--
-- So intake goes through `api/dsar.ts`, which holds the service role key, derives identity from
-- a verified JWT when there is one, rate-limits, and never reads a tenant id from the client.
-- This migration therefore does NOT add an INSERT policy: the absence is the design. What it
-- adds is the audit trail that makes a service-role write reviewable.

-- ---------------------------------------------------------------------------
-- Request context, recorded because Art. 12(6) turns on being able to show how a request was
-- received and how identity was established.
-- ---------------------------------------------------------------------------
ALTER TABLE public.data_subject_requests
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'web_form'
    CHECK (source IN ('web_form', 'authenticated_app', 'email', 'post', 'import'));

ALTER TABLE public.data_subject_requests
  ADD COLUMN IF NOT EXISTS subject_message TEXT;

-- Free text from an unauthenticated caller is the one field an attacker fully controls. It is
-- shown to an admin, so cap it in the database as well as at the endpoint — an endpoint check
-- protects the endpoint, a constraint protects the table.
ALTER TABLE public.data_subject_requests
  DROP CONSTRAINT IF EXISTS subject_message_is_bounded;
ALTER TABLE public.data_subject_requests
  ADD CONSTRAINT subject_message_is_bounded
    CHECK (subject_message IS NULL OR length(subject_message) <= 2000);

ALTER TABLE public.data_subject_requests
  DROP CONSTRAINT IF EXISTS subject_email_is_bounded;
ALTER TABLE public.data_subject_requests
  ADD CONSTRAINT subject_email_is_bounded
    CHECK (length(subject_email) <= 320);  -- RFC 5321 maximum path length

-- ---------------------------------------------------------------------------
-- Anti-flood, enforced where it cannot be bypassed.
--
-- The endpoint rate-limits per address, which is the right first line and is also per-process
-- and therefore multiplied by however many instances are running. This index is the backstop:
-- one open request per email address per request type. A subject filing the same erasure
-- request twice does not create two statutory clocks, and a flood cannot fill the queue.
--
-- Deliberately partial. Once a request is completed or refused the same subject may file again,
-- which they are entitled to do.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_dsr_one_open_per_subject
  ON public.data_subject_requests (lower(subject_email), request_type)
  WHERE status NOT IN ('completed', 'refused');

-- ---------------------------------------------------------------------------
-- Closing a request must say who closed it.
--
-- The UPDATE policy already restricts writes to admins of the owning tenant. What it cannot do
-- is record which admin, and "the organisation completed it" is not an accountability record
-- under Art. 5(2). RLS decides rows; it never fills in columns.
-- ---------------------------------------------------------------------------
ALTER TABLE public.data_subject_requests
  ADD COLUMN IF NOT EXISTS handled_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION app.stamp_dsr_handler()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  -- Only on a state change, so an admin adding a note does not rewrite who resolved it.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.handled_by := auth.uid();

    -- The completion timestamp is server-generated for the same reason every other compliance
    -- timestamp in this schema is: a client-supplied date on a statutory deadline is a date
    -- somebody chose. `completion_is_dated` already refuses a completed row without one, and
    -- filling it here means an admin cannot satisfy that constraint by inventing a value.
    IF NEW.status = 'completed'::public.dsr_status AND NEW.completed_at IS NULL THEN
      NEW.completed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_dsr_handler ON public.data_subject_requests;
CREATE TRIGGER stamp_dsr_handler
  BEFORE UPDATE ON public.data_subject_requests
  FOR EACH ROW EXECUTE FUNCTION app.stamp_dsr_handler();

COMMENT ON TABLE public.data_subject_requests IS
  'GDPR Art. 12-22 and US state privacy law requests. Written only by api/dsar.ts under the '
  'service role — there is deliberately no INSERT policy, because the subjects most likely to '
  'file have no account to authenticate as and organization_id must never come from a client.';
