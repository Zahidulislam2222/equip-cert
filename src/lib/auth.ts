import { supabase } from './supabase';
import { config } from './config';

// Row shapes come from the generated schema types, not from a hand-written copy kept next to
// the query. See src/lib/db.ts for why. Imported as well as re-exported: the signatures in
// this file use them, and a bare `export ... from` would not bring them into scope here.
import type { Profile, Organization, UserRole } from './db';

export type { Profile, Organization, UserRole };

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error) return null;
  return data;
}

export async function getOrganization(orgId: string): Promise<Organization | null> {
  const { data, error } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', orgId)
    .single();

  if (error) return null;
  return data;
}

/**
 * Create an account.
 *
 * Email confirmation is on, so `auth.signUp` normally returns NO session — and nothing that
 * needs `auth.uid()` can run yet (DEF-045). The organisation name travels in the account's own
 * metadata, and the tenant is created by `provision_account()` on the first signed-in load
 * (see AuthProvider). `orgName` is null when the person is joining through an invitation.
 *
 * Returns `pendingConfirmation: true` when the person must click the link in their inbox.
 */
export async function signUp(
  email: string,
  password: string,
  fullName: string,
  orgName: string | null,
): Promise<{ pendingConfirmation: boolean }> {
  const metadata: Record<string, string> = { full_name: fullName.trim() };
  if (orgName && orgName.trim()) metadata.org_name = orgName.trim();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: metadata,
      emailRedirectTo: `${config.app.url}/auth/login`,
    },
  });
  if (error) throw error;
  if (!data.user) throw new Error('Signup failed');

  // A session here means auto-confirm is on: provision now rather than point at an empty inbox.
  if (data.session) {
    await completeOnboarding();
    return { pendingConfirmation: false };
  }
  return { pendingConfirmation: true };
}

/** Create the caller's organisation from their signup metadata. Idempotent. */
export async function provisionAccount(): Promise<string> {
  const { data, error } = await supabase.rpc('provision_account');
  if (error) throw error;
  return data;
}

/** Join an existing organisation with a single-use invitation token. */
export async function acceptInvite(token: string): Promise<string> {
  const { data, error } = await supabase.rpc('accept_invite', { p_token: token.trim() });
  if (error) throw error;
  // A new member is a new paid seat on a per-user plan. Best effort: the webhook re-syncs before
  // every renewal, so a failure here cannot leave the seat unbilled past the next invoice.
  void requestSeatSync();
  return data;
}

/** Ask the server to bill the organisation's current member count. Never throws. */
export async function requestSeatSync(): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    await fetch('/api/billing/seats', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  } catch {
    // Best effort by design — see acceptInvite.
  }
}

// The invitation link carries its token in the URL FRAGMENT (#invite=...), which browsers never
// send to a server — so it stays out of proxy logs and Referer headers. It is parked in local
// storage (the email-confirmation link opens a NEW tab, which session storage would not reach)
// until the person is signed in and redeems it; redeeming removes it.
const PENDING_INVITE_KEY = 'equipcert.pendingInvite';

/** Subscribe to fragment changes — for useSyncExternalStore. */
export function subscribeToHash(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

export function readInviteFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  const match = window.location.hash.match(/(?:^#|&)invite=([A-Za-z0-9_-]{20,128})/);
  return match ? match[1] : null;
}

export function rememberPendingInvite(token: string): void {
  try {
    window.localStorage.setItem(PENDING_INVITE_KEY, token);
  } catch {
    // Storage blocked: the person can still paste the link on the onboarding screen.
  }
}

/** accept_invite SQLSTATEs that mean the token can never be redeemed by this account. */
const INVITE_FINAL_CODES = new Set(['22023', '23505']);

/** The parked token, left in place: it is removed only once redeemed or refused (below). */
export function peekPendingInvite(): string | null {
  try {
    return window.localStorage.getItem(PENDING_INVITE_KEY);
  } catch {
    return null;
  }
}

/**
 * Forget the parked token. Called after it is redeemed, after the server refuses it, and when the
 * signed-in account already belongs to an organisation — otherwise a token parked by one account
 * would sit on a shared device until the next profile-less account redeemed it automatically.
 */
export function discardPendingInvite(): void {
  try {
    window.localStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    // Storage blocked: nothing was parked.
  }
}

/** Extract a token from a pasted invitation link or a bare token. */
export function parseInviteInput(input: string): string | null {
  const trimmed = input.trim();
  const fromLink = trimmed.match(/invite=([A-Za-z0-9_-]{20,128})/);
  if (fromLink) return fromLink[1];
  return /^[A-Za-z0-9_-]{20,128}$/.test(trimmed) ? trimmed : null;
}

/**
 * Give a signed-in account with no profile its organisation: redeem a parked invitation first,
 * otherwise create the tenant named at signup. Returns false when neither applies, so the caller
 * can ask the person what they want to do.
 */
// Single flight: the initial session load and the auth-state listener both reach this on the
// same page load. Two concurrent provisions would make the second fail on profiles.user_id and
// report an error for an account that was set up correctly.
let onboardingInFlight: Promise<boolean> | null = null;

export function completeOnboarding(): Promise<boolean> {
  onboardingInFlight ??= runOnboarding().finally(() => {
    onboardingInFlight = null;
  });
  return onboardingInFlight;
}

async function runOnboarding(): Promise<boolean> {
  const invite = peekPendingInvite();
  if (invite) {
    try {
      await acceptInvite(invite);
    } catch (err) {
      // Forget the token only when accept_invite itself refused it for good: invalid/expired
      // (22023) or this account already has an organisation (23505). Anything else — no network,
      // database unavailable (PGRST00x), an expired session, a full organisation (23514) — may
      // succeed later, so the token is kept for the next attempt (review 2, 2026-11-25).
      const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: string }).code : undefined;
      if (code && INVITE_FINAL_CODES.has(code)) discardPendingInvite();
      throw err;
    }
    discardPendingInvite();
    return true;
  }
  const { data } = await supabase.auth.getUser();
  const orgName = data.user?.user_metadata?.org_name;
  if (typeof orgName === 'string' && orgName.trim()) {
    await provisionAccount();
    return true;
  }
  return false;
}

/**
 * Record e-signature consent as evidence. The server stamps the time; the version names the
 * wording shown (src/content/esign-consent.json). Re-recording the same version is a no-op.
 */
export async function recordEsignConsent(version: string): Promise<void> {
  const { error } = await supabase.rpc('record_esign_consent', { p_version: version });
  if (error) throw error;
}

/**
 * Call `onSignedIn` once a session exists — immediately if there already is one, or when the
 * email-confirmation / magic-link redirect lands here and supabase-js finishes reading the URL.
 * Without it a person who just confirmed their address was shown the sign-in form again.
 */
export function whenSignedIn(onSignedIn: () => void): () => void {
  let done = false;
  const fire = () => {
    if (done) return;
    done = true;
    onSignedIn();
  };
  void supabase.auth.getSession().then(({ data }) => {
    if (data.session) fire();
  });
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) fire();
  });
  return () => data.subscription.unsubscribe();
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function signInWithOAuth(provider: 'google' | 'azure') {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${window.location.origin}/app/dashboard` },
  });
  if (error) throw error;
}

export async function signInWithMagicLink(email: string) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${window.location.origin}/app/dashboard` },
  });
  if (error) throw error;
}
