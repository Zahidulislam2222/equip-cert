'use client';

import { supabase } from '@/lib/supabase';
import { config } from '@/lib/config';

/**
 * Evidence storage — inspection photos, corrective-action photos and signatures.
 *
 * This module exists because the previous approach was a security hole (DEF-017). Evidence
 * went into a PUBLIC bucket under a filename that was only a millisecond timestamp
 * (`signature-1757462400000.png`), with no organization anywhere in the path, and was then
 * addressed with `getPublicUrl()`. A public object URL needs no session, no token and no
 * policy check, so row level security protected the database row that POINTED at the file
 * while the file itself was served to anyone who asked — across every tenant.
 *
 * The replacement has four parts, and all four are needed:
 *
 *   1. A private bucket, so there is no unauthenticated read path at all.
 *   2. The organization as the FIRST path segment, so a storage policy has something to
 *      scope by. `storage.foldername(name)[1]` is what the policy compares.
 *   3. A random object name, so the address cannot be derived from a clock.
 *   4. Short-lived signed URLs issued per view, so a leaked link expires.
 *
 * The bucket name and the path shape are a contract with
 * `supabase/migrations/20260910000300_storage.sql`. Changing either one here without changing
 * it there breaks uploads at runtime, not at build time — the policy simply stops matching.
 */

/** Must equal the bucket created in 20260910000300_storage.sql. */
export const EVIDENCE_BUCKET = 'evidence';

/** Second path segment. Groups objects by what they are evidence OF. */
export type EvidenceKind = 'inspection' | 'signature' | 'corrective' | 'equipment';

/** A stored reference. Always a bucket-relative path, never a URL. */
export type EvidencePath = string;

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Upload one file and return the path to store on the record.
 *
 * Returns a PATH, not a URL. Persisting a URL is what made the old bug permanent: the row
 * carried a publicly resolvable address forever, so even after the bucket was locked down the
 * database would still be handing out links. A path is meaningless without a policy check.
 *
 * Throws on failure rather than returning null. The previous call sites did
 * `if (!uploadError) { ...set the url... }`, which silently recorded an inspection with no
 * photo when the upload failed — the evidence was missing and nobody was told.
 */
export async function uploadEvidence(
  kind: EvidenceKind,
  organizationId: string,
  blob: Blob
): Promise<EvidencePath> {
  if (!organizationId) {
    // Without this the object lands under a path no policy matches, and the upload is
    // rejected with an opaque error. Failing here names the actual problem.
    throw new Error('Cannot store evidence without an organization.');
  }

  const extension = EXTENSION_BY_TYPE[blob.type];
  if (!extension) {
    throw new Error(`Unsupported evidence type: ${blob.type || 'unknown'}`);
  }

  const path = `${organizationId}/${kind}/${crypto.randomUUID()}.${extension}`;

  const { error } = await supabase.storage.from(EVIDENCE_BUCKET).upload(path, blob, {
    contentType: blob.type,
    // Never overwrite. An upload that replaces existing evidence is indistinguishable from
    // tampering with it, and the path is random so a collision means something is wrong.
    upsert: false,
  });

  if (error) throw new Error(`Evidence upload failed: ${error.message}`);
  return path;
}

/**
 * Issue a short-lived URL for viewing one stored object.
 *
 * Returns null instead of throwing: a missing thumbnail should degrade to a placeholder, not
 * take down the page that lists a hundred inspections.
 */
export async function signedEvidenceUrl(path: EvidencePath | null): Promise<string | null> {
  if (!path) return null;

  // Defensive: a project restored from an older backup may still hold absolute public URLs
  // written before DEF-017 was fixed. Pass them through rather than crashing, so the record
  // still renders while the migration flips that bucket private underneath it.
  if (/^https?:\/\//i.test(path)) return path;

  const { data, error } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .createSignedUrl(path, config.storage.signedUrlTtlSeconds);

  if (error || !data) return null;
  return data.signedUrl;
}

/**
 * Issue URLs for many objects in one request.
 *
 * A table of inspections would otherwise make one round trip per row. At 50 rows that is 50
 * sequential requests before the first thumbnail appears — the kind of N+1 that only shows up
 * once real data exists.
 */
export async function signedEvidenceUrls(
  paths: readonly (EvidencePath | null)[]
): Promise<Map<EvidencePath, string>> {
  const resolved = new Map<EvidencePath, string>();

  const needed = [...new Set(paths.filter((p): p is EvidencePath => !!p))];
  if (needed.length === 0) return resolved;

  // Legacy absolute URLs cannot be signed; they are already addressable.
  const legacy = needed.filter((p) => /^https?:\/\//i.test(p));
  for (const url of legacy) resolved.set(url, url);

  const toSign = needed.filter((p) => !/^https?:\/\//i.test(p));
  if (toSign.length === 0) return resolved;

  const { data, error } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .createSignedUrls(toSign, config.storage.signedUrlTtlSeconds);

  if (error || !data) return resolved;

  for (const entry of data) {
    if (entry.signedUrl && entry.path) resolved.set(entry.path, entry.signedUrl);
  }
  return resolved;
}
