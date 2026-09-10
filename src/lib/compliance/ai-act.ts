// EU AI Act Article 50 — transparency for AI-generated content.
//
// Two obligations with two different deadlines, and they are easy to conflate:
//
//   Art. 50(1)  disclosure to the human interacting with the system.
//               Binding since 2 August 2026, NO grace period.
//   Art. 50(2)  machine-readable marking of generated output.
//               Pre-existing systems have until 2 December 2026 (AI Omnibus, May 2026).
//
// This module owns the first. The disclosure text itself lives in
// `src/content/ai-disclosure.json` so that legal copy is edited in one place by someone who
// is not reading TSX — the same reason the inspection-flight labels live in content.
//
// Classification note: EquipCert is NOT high-risk under Annex III. Photo analysis that
// suggests a checklist to a qualified human inspector is neither a safety component of
// critical infrastructure nor an employment decision. The reasoning is recorded in
// docs/compliance/ai-act-classification.md. Article 50 still applies regardless of risk tier.

import disclosure from '@/content/ai-disclosure.json';

export const aiDisclosure = disclosure;

/**
 * Provenance for one AI-assisted result.
 *
 * The provider and model are supplied by the SERVER. A client cannot know which model ran —
 * it is chosen from server-only configuration — and a client-asserted provenance value would
 * be traceability theatre.
 */
export interface AiProvenance {
  aiAssisted: true;
  provider: string;
  model: string;
  /** Server-generated ISO timestamp of the moment the disclosure obligation was triggered. */
  disclosedAt: string;
}

/** Shape written to the `inspections` AI provenance columns. */
export interface AiProvenanceColumns {
  ai_assisted: boolean;
  ai_provider: string | null;
  ai_model: string | null;
  ai_disclosed_at: string | null;
}

/**
 * Narrowing guard for a provenance object arriving from the analyze endpoint.
 *
 * Untrusted input: this crosses a network boundary, so it is validated rather than cast.
 */
export function isAiProvenance(value: unknown): value is AiProvenance {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.aiAssisted === true &&
    typeof v.provider === 'string' &&
    v.provider.length > 0 &&
    typeof v.model === 'string' &&
    v.model.length > 0 &&
    typeof v.disclosedAt === 'string' &&
    v.disclosedAt.length > 0
  );
}

/**
 * Map provenance onto the inspection columns.
 *
 * The database enforces `ai_provenance_is_complete`: either every AI column is NULL and
 * `ai_assisted` is false, or provider and model are both present. Passing `null` here is the
 * honest "no AI was involved" case, not a missing value to be papered over.
 */
export function toProvenanceColumns(provenance: AiProvenance | null): AiProvenanceColumns {
  if (!provenance) {
    return {
      ai_assisted: false,
      ai_provider: null,
      ai_model: null,
      ai_disclosed_at: null,
    };
  }
  return {
    ai_assisted: true,
    ai_provider: provenance.provider,
    ai_model: provenance.model,
    ai_disclosed_at: provenance.disclosedAt,
  };
}
