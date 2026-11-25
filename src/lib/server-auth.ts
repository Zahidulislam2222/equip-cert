// Server-side caller identification for the standalone API handlers (api/*). Never import in
// client code.
//
// FAIL CLOSED (the DEF-034 lesson): missing Supabase configuration is a 503, never a skipped check.
// The returned `userClient` carries the caller's own JWT, so every read made with it is filtered by
// RLS exactly as the browser's would be — the handler cannot accidentally read another tenant.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config';
import type { Database } from './database.types';
import type { UserRole } from './db';

export interface Caller {
  userId: string;
  email: string | null;
  profileId: string;
  organizationId: string;
  role: UserRole;
  userClient: SupabaseClient<Database>;
}

export type CallerResult = { ok: true; caller: Caller } | { ok: false; status: number; error: string };

export async function identifyCaller(authorization: string | undefined): Promise<CallerResult> {
  if (!authorization?.startsWith('Bearer ')) return { ok: false, status: 401, error: 'Unauthorized' };

  const { url, anonKey } = config.supabase;
  if (!url || !anonKey) {
    console.error('Auth not configured: NEXT_PUBLIC_SUPABASE_URL / ANON_KEY missing.');
    return { ok: false, status: 503, error: 'Service unavailable' };
  }

  const token = authorization.slice(7);
  const userClient = createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData?.user) return { ok: false, status: 401, error: 'Invalid token' };

  const { data: profile, error: profileError } = await userClient
    .from('profiles')
    .select('id, org_id, role')
    .eq('user_id', authData.user.id)
    .maybeSingle();
  if (profileError) return { ok: false, status: 503, error: 'Service unavailable' };
  if (!profile) return { ok: false, status: 403, error: 'This account is not part of an organisation yet.' };

  return {
    ok: true,
    caller: {
      userId: authData.user.id,
      email: authData.user.email ?? null,
      profileId: profile.id,
      organizationId: profile.org_id,
      role: profile.role,
      userClient,
    },
  };
}

/** First X-Forwarded-For hop — the generated Caddy file and Vercel both overwrite this header. */
export function clientIpOf(forwardedFor: string | string[] | undefined): string {
  const raw = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  return raw?.split(',')[0]?.trim() || 'unknown';
}
