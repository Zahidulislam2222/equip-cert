-- EquipCert AI — evidence storage
--
-- This closes the most serious hole in the previous build.
--
-- Photos, corrective-action photos and handwritten signatures were all uploaded to a bucket
-- named `photos` that was PUBLIC, under filenames that were nothing but a millisecond
-- timestamp — `signature-1757462400000.png` — with no organisation anywhere in the path.
-- Three separate failures in one line of code:
--
--   * Public bucket. `getPublicUrl()` returns a URL that needs no token, no session and no
--     policy check. Row level security on the database protected the row that POINTED at the
--     file while the file itself was served to anyone who asked.
--   * Guessable name. A millisecond timestamp inside business hours is a small search space,
--     and any URL that ever leaked — a PDF report, an email, a shared link — stayed valid
--     forever.
--   * No tenant in the path. Even with policies there was nothing to scope them by, so one
--     customer's evidence sat in the same flat namespace as every other customer's.
--
-- A signature is personal data. Serving one to the open internet is a GDPR Article 32
-- failure and, if exploited, a notifiable breach.
--
-- The replacement is a private bucket, an organisation-scoped path, an unguessable object
-- name, and short-lived signed URLs issued per view.

-- ---------------------------------------------------------------------------
-- The bucket.
--
-- `public = false` is the whole point. The size cap matches the client-side downscale in
-- src/lib/capture.ts with headroom; the MIME allow-list means an upload slot for inspection
-- photos cannot be repurposed to host scripts or HTML on the project's own origin.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'evidence',
  'evidence',
  false,
  8388608, -- 8 MiB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Object path contract: <organization_id>/<kind>/<random>.<ext>
--
--   0f3c...e91/inspection/9f2a4c6e-....jpg
--   0f3c...e91/signature/1b77de20-....png
--
-- The first segment is the tenant, so `storage.foldername(name)[1]` is all a policy needs to
-- decide. The client is responsible for generating a random object name — crypto.randomUUID()
-- — rather than anything derived from a clock.
-- ---------------------------------------------------------------------------

/*
 * True when `object_name`'s leading path segment is the caller's organisation.
 *
 * A helper rather than four copies of the same expression, because the day this is wrong in
 * one policy and right in three is the day tenants leak into each other.
 */
CREATE OR REPLACE FUNCTION app.owns_storage_path(object_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT (storage.foldername(object_name))[1] = (SELECT app.current_org_id())::text;
$$;

GRANT EXECUTE ON FUNCTION app.owns_storage_path(TEXT) TO authenticated;

-- Supabase ships RLS enabled on storage.objects; assert it rather than assume it.
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS evidence_read_own_org   ON storage.objects;
DROP POLICY IF EXISTS evidence_insert_own_org ON storage.objects;
DROP POLICY IF EXISTS evidence_update_admin   ON storage.objects;
DROP POLICY IF EXISTS evidence_delete_admin   ON storage.objects;

-- Read is what signed-URL issuance checks against.
CREATE POLICY evidence_read_own_org ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'evidence' AND app.owns_storage_path(name));

CREATE POLICY evidence_insert_own_org ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'evidence' AND app.owns_storage_path(name));

-- Overwriting evidence is indistinguishable from tampering with it, so neither UPDATE nor
-- DELETE is available to ordinary members. Retention disposal runs as the service role.
CREATE POLICY evidence_update_admin ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'evidence' AND app.owns_storage_path(name) AND (SELECT app.is_admin()))
  WITH CHECK (bucket_id = 'evidence' AND app.owns_storage_path(name));

CREATE POLICY evidence_delete_admin ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'evidence' AND app.owns_storage_path(name) AND (SELECT app.is_admin()));

-- ---------------------------------------------------------------------------
-- The old bucket.
--
-- Left in place deliberately rather than dropped: if a legacy `photos` bucket ever exists in
-- a restored project, its contents are evidence a customer may still need, and dropping a
-- bucket destroys the objects. Flipping it private makes every previously public URL stop
-- resolving immediately, which is the urgent half. Migrating or disposing of the contents is
-- a decision for whoever restores it.
-- ---------------------------------------------------------------------------
UPDATE storage.buckets SET public = false WHERE id = 'photos';
