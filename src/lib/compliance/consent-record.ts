// Server-side consent audit trail.
//
// The banner decision lives in localStorage because it must work before sign-in and it is
// per-browser. That is necessary but not sufficient: localStorage is not evidence. It can be
// cleared by the user, is invisible to us, and proves nothing about what was shown or when.
//
// GDPR Art. 7(1) requires the controller to be able to DEMONSTRATE consent. So for signed-in
// users the same decision is also appended to `consent_records`, which is versioned per
// document, append-only at the trigger level, and timestamped by the database rather than by
// the client — a client-supplied consent time is not evidence of anything.
//
// This runs best-effort. A failed audit write must never block the user's privacy choice from
// taking effect locally; refusing to honour a rejection because a network call failed would
// invert the entire point.

import { supabase } from '@/lib/supabase';
import { consentCopy, type ConsentDecision } from '@/lib/compliance/consent';

/** Purposes recognised by the `consent_records.purpose` CHECK constraint. */
export type ConsentPurpose =
  | 'terms'
  | 'privacy_policy'
  | 'esign_disclosure'
  | 'ai_processing'
  | 'marketing_email';

interface RecordArgs {
  userId: string;
  organizationId: string;
  purpose: ConsentPurpose;
  granted: boolean;
  documentVersion?: string;
}

/**
 * Append one consent decision.
 *
 * `recorded_at` is intentionally omitted so the column default (`now()`) applies — the
 * database is the clock. `ip_address` is likewise omitted: the browser cannot observe its own
 * public IP, and inventing one would put a fabricated value in an evidence table.
 */
export async function recordConsent({
  userId,
  organizationId,
  purpose,
  granted,
  documentVersion = consentCopy.documentVersion,
}: RecordArgs): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase.from('consent_records').insert([
      {
        user_id: userId,
        organization_id: organizationId,
        purpose,
        document_version: documentVersion,
        granted,
        method: 'web_form',
        user_agent: typeof navigator === 'undefined' ? null : navigator.userAgent,
      },
    ]);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown error' };
  }
}

/**
 * Mirror a browser-storage decision into the audit trail.
 *
 * Called after the local decision is already in effect, never before.
 */
export async function recordStorageConsent(
  decision: ConsentDecision,
  userId: string | null | undefined,
  organizationId: string | null | undefined,
): Promise<void> {
  if (!userId || !organizationId) return; // anonymous visitor — localStorage is all there is
  const granted = Object.entries(decision.categories).some(
    ([id, value]) => id !== 'essential' && value === true,
  );
  await recordConsent({
    userId,
    organizationId,
    purpose: 'privacy_policy',
    granted,
    documentVersion: decision.documentVersion,
  });
}
