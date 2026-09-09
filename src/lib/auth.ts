import { supabase } from './supabase';

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

export async function signUp(email: string, password: string, fullName: string, orgName: string) {
  // 1. Create auth user
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });

  if (authError) throw authError;
  if (!authData.user) throw new Error('Signup failed');

  // 2. Create organization
  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .insert({
      name: orgName,
      slug: orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    })
    .select()
    .single();

  if (orgError) throw orgError;

  // 3. Create profile (admin for org creator)
  const { error: profileError } = await supabase
    .from('profiles')
    .insert({
      user_id: authData.user.id,
      org_id: org.id,
      full_name: fullName,
      role: 'admin',
    });

  if (profileError) throw profileError;

  return { user: authData.user, organization: org };
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
