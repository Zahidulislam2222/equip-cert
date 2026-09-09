'use client';

import { config } from '@/lib/config';

/**
 * Reject passwords that appear in known breach corpora.
 *
 * WHY THIS IS HAND-ROLLED
 *
 * Supabase ships exactly this as "leaked password protection", and `supabase db advisors
 * --type security` flags the project for having it off. It is a **Pro-plan feature**, and this
 * project is on the free plan and staying there. So rather than record the advisory as an
 * accepted risk, the same check is implemented against the same upstream source, which is free
 * and needs no API key.
 *
 * HOW IT STAYS PRIVATE — the k-anonymity range protocol
 *
 * The password never leaves the device, and neither does its full hash:
 *
 *   1. SHA-1 the password locally.
 *   2. Send only the first FIVE hex characters of that hash to the range endpoint.
 *   3. The service returns every known hash suffix sharing that prefix — several hundred.
 *   4. Match the remaining 35 characters locally.
 *
 * The service therefore sees a 5-character prefix shared by hundreds of thousands of distinct
 * passwords. It never sees the password, never sees the full hash, and cannot tell which of
 * the returned suffixes — if any — was the one being asked about.
 *
 * SHA-1 is correct here and is not a security decision. It is the index format the corpus is
 * published in; the hash is never stored, never transmitted in full, and never used to
 * authenticate anything.
 *
 * WHY BREACH-CHECKING RATHER THAN COMPOSITION RULES
 *
 * NIST SP 800-63B explicitly recommends checking candidate passwords against breach lists and
 * explicitly recommends AGAINST composition rules ("must contain a symbol"), which push people
 * toward predictable substitutions. So the project raised `minimum_password_length` to 12,
 * left `password_requirements` empty, and does this instead.
 */

export type PasswordVerdict =
  | { ok: true }
  | { ok: false; reason: 'too_short'; minLength: number }
  | { ok: false; reason: 'breached'; occurrences: number };

/** SHA-1 of `input`, uppercase hex. */
async function sha1Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/**
 * How many times this password appears in the breach corpus, or 0.
 *
 * Returns 0 when the lookup itself fails. A breach-list outage must not become a login outage:
 * length is still enforced, and failing closed here would lock every new user out of signing
 * up because a third-party service was down.
 */
export async function breachCount(password: string): Promise<number> {
  let hash: string;
  try {
    hash = await sha1Hex(password);
  } catch {
    // crypto.subtle is unavailable outside a secure context.
    return 0;
  }

  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.passwordSafety.timeoutMs);

    const response = await fetch(`${config.passwordSafety.rangeUrl}/${prefix}`, {
      signal: controller.signal,
      // Adds random decoy hashes to the response so its SIZE leaks nothing either.
      headers: { 'Add-Padding': 'true' },
    });
    clearTimeout(timer);

    if (!response.ok) return 0;

    for (const line of (await response.text()).split('\n')) {
      const [candidate, count] = line.trim().split(':');
      if (candidate === suffix) return Number.parseInt(count ?? '0', 10) || 0;
    }
    return 0;
  } catch {
    return 0;
  }
}

/** Full check used by the signup and password-change forms. */
export async function checkPassword(password: string): Promise<PasswordVerdict> {
  const minLength = config.passwordSafety.minLength;
  if (password.length < minLength) {
    return { ok: false, reason: 'too_short', minLength };
  }

  const occurrences = await breachCount(password);
  if (occurrences > 0) {
    return { ok: false, reason: 'breached', occurrences };
  }

  return { ok: true };
}

/** Message shown to the person. Phrased as guidance, never as blame. */
export function describeVerdict(verdict: PasswordVerdict): string | null {
  if (verdict.ok) return null;
  if (verdict.reason === 'too_short') {
    return `Use at least ${verdict.minLength} characters. Length matters far more than symbols.`;
  }
  return (
    `This password has appeared in ${verdict.occurrences.toLocaleString()} known data breaches, ` +
    'so attackers already try it. Choose a different one.'
  );
}
