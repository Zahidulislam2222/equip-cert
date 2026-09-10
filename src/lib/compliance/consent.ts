// Consent state for browser storage, and the audit trail behind it.
//
// Three regimes drive this file and they want different things:
//
//   GDPR / ePrivacy  consent must be freely given, specific, informed and unambiguous, and
//                    withdrawal must be as easy as granting (Art. 7(3)). The EDPB treats a
//                    reject option that is harder to reach than accept as a dark pattern that
//                    invalidates the consent entirely.
//   US state law     from 1 Jan 2026, twelve states require an opt-out preference signal
//                    (GPC) to be honoured AND require the consumer to be able to confirm it
//                    was processed. A silent honour is not compliance.
//   Both             a decision is evidence only if it records what was agreed to and when.
//
// The copy lives in `src/content/consent.json`. This module owns behaviour only.

import consentContent from '@/content/consent.json';

export const consentCopy = consentContent;

/** Optional categories, derived from content so the two cannot drift. */
export const OPTIONAL_CATEGORY_IDS = consentContent.categories
  .filter((c) => !c.required)
  .map((c) => c.id);

/**
 * Storage key. Deliberately versioned: if the categories change, an old stored decision is
 * consent to a document that no longer exists and must be re-asked rather than honoured.
 */
const STORAGE_KEY = `equipcert-consent-v${consentContent.documentVersion}`;

export interface ConsentDecision {
  /** Category id -> granted. Required categories are always true. */
  categories: Record<string, boolean>;
  /** ISO timestamp of the decision, client-side. The server record is authoritative. */
  decidedAt: string;
  /** Which version of the consent document was shown. */
  documentVersion: string;
  /** True when the decision was forced by a Global Privacy Control signal. */
  viaGpc: boolean;
}

/**
 * Does this browser send Global Privacy Control?
 *
 * Read defensively: the property is not in every browser's typings, and reading an unknown
 * navigator property must never throw during first paint.
 */
export function hasGpcSignal(): boolean {
  if (typeof navigator === 'undefined') return false;
  try {
    return (navigator as unknown as Record<string, unknown>).globalPrivacyControl === true;
  } catch {
    return false;
  }
}

/**
 * Read the stored decision.
 *
 * Every storage access is wrapped: private mode, disabled site data and embedded webviews all
 * throw here rather than returning null, and a privacy control that crashes the app on load
 * is worse than the problem it solves.
 */
export function readConsent(): ConsentDecision | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConsentDecision;
    // A decision recorded against a different document version is not a decision about this one.
    if (parsed?.documentVersion !== consentContent.documentVersion) return null;
    if (typeof parsed.categories !== 'object' || parsed.categories === null) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Persist a decision. Returns the stored object so callers can render it without re-reading. */
export function writeConsent(
  categories: Record<string, boolean>,
  viaGpc = false,
): ConsentDecision {
  const decision: ConsentDecision = {
    categories: { ...categories, essential: true },
    decidedAt: new Date().toISOString(),
    documentVersion: consentContent.documentVersion,
    viaGpc,
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(decision));
  } catch {
    // Storage refused. The decision still governs this page view via React state; it simply
    // will not survive a reload, and asking again is the safe failure.
  }
  // Withdrawing must actually remove what was stored, not merely stop writing more. A
  // "preferences: false" flag with the theme key still sitting in localStorage is not
  // withdrawal, it is a promise of withdrawal.
  if (decision.categories.preferences === false) {
    purgePreferenceStorage();
  }
  // Same rule, higher stakes: a withdrawn marketing consent that leaves `_fbp` on the device
  // is not a withdrawal, it is a promise of one.
  if (decision.categories[MARKETING_CATEGORY_ID] === false) {
    purgeMarketingStorage();
  }
  try {
    window.dispatchEvent(new CustomEvent(CONSENT_CHANGED_EVENT, { detail: decision }));
  } catch {
    /* no window (SSR) — nothing is listening there anyway */
  }
  return decision;
}

/** Everything the optional "preferences" category is allowed to store. */
const PREFERENCE_KEYS = ['theme'] as const;
const PREFERENCE_SESSION_KEYS = ['ec:intro-played'] as const;

/** The category that gates every third-party advertising / CRM tag. */
export const MARKETING_CATEGORY_ID = 'marketing';

/**
 * Fired after any decision is written, so anything gated on consent reacts in THIS tab.
 *
 * The `storage` event deliberately does not fire in the tab that caused the change, so a
 * component listening only for `storage` would keep a withdrawn tag loaded until reload. A
 * withdrawal that takes effect on the next page view is not withdrawal.
 */
export const CONSENT_CHANGED_EVENT = 'equipcert:consent-changed';

/**
 * Cookies the marketing tags set, which withdrawal must actually remove.
 *
 * `_fbp` and `_fbc` are Meta's browser and click identifiers. Removing the script tag without
 * removing these leaves the identifier on the device and readable on the next Meta request —
 * "we stopped loading it" is not withdrawal, and Art. 7(3) requires withdrawal to be as easy
 * as granting, which means as EFFECTIVE as granting.
 *
 * Set on the registrable domain, so deletion is attempted per-path and per-domain scope; a
 * cookie written for `.example.com` is not removed by a delete scoped to `www.example.com`.
 */
const MARKETING_COOKIES = ['_fbp', '_fbc'] as const;

/** Delete the marketing tags' cookies across the scopes they could have been set on. */
export function purgeMarketingStorage(): void {
  if (typeof document === 'undefined') return;
  const host = window.location.hostname;
  // "a.b.example.com" -> ["a.b.example.com", "b.example.com", "example.com"]. Walking up is
  // the only reliable way to clear a cookie whose Domain attribute we cannot read back.
  const parts = host.split('.');
  const domains = [undefined as string | undefined];
  for (let i = 0; i < parts.length - 1; i += 1) domains.push(`.${parts.slice(i).join('.')}`);

  for (const name of MARKETING_COOKIES) {
    for (const domain of domains) {
      const scope = domain ? `; domain=${domain}` : '';
      try {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${scope}`;
      } catch {
        /* nothing to remove, or a scope this document may not write */
      }
    }
  }
}

/** Remove optional storage. Called on withdrawal and on a GPC-forced opt-out. */
export function purgePreferenceStorage(): void {
  try {
    for (const key of PREFERENCE_KEYS) window.localStorage.removeItem(key);
  } catch {
    /* storage unavailable — nothing was written either */
  }
  try {
    for (const key of PREFERENCE_SESSION_KEYS) window.sessionStorage.removeItem(key);
  } catch {
    /* as above */
  }
}

/** Is an optional category currently permitted? Defaults to NO before any decision. */
export function isGranted(categoryId: string, decision = readConsent()): boolean {
  if (categoryId === 'essential') return true;
  return decision?.categories?.[categoryId] === true;
}

/** All optional categories off — the shape used by "Reject optional" and by GPC. */
export function denyAllOptional(): Record<string, boolean> {
  return Object.fromEntries(OPTIONAL_CATEGORY_IDS.map((id) => [id, false]));
}

/** All optional categories on — the shape used by "Accept all". */
export function grantAllOptional(): Record<string, boolean> {
  return Object.fromEntries(OPTIONAL_CATEGORY_IDS.map((id) => [id, true]));
}
