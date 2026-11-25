// Team management — members, roles, invitations.
//
// Every write here is authorised by the DATABASE, not by this file: role changes by
// guard_profile_privileges (admin only, never your own), removals by profiles_delete_admin,
// invitations by create_invite / revoke_invite (admin only, seat-limited by plan). The UI hides
// what a role cannot do; it never decides it.

import { requestSeatSync } from './auth';
import { supabase } from './supabase';
import { config } from './config';
import type { UserRole } from './db';

export interface TeamMember {
  id: string;
  user_id: string;
  full_name: string;
  role: UserRole;
  created_at: string;
  anonymized_at: string | null;
}

export interface PendingInvite {
  id: string;
  role: UserRole;
  created_at: string;
  expires_at: string;
}

export interface SeatUsage {
  members: number;
  pendingInvites: number;
  /** null = unlimited on this plan. */
  maxUsers: number | null;
}

export async function listMembers(organizationId: string): Promise<TeamMember[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, user_id, full_name, role, created_at, anonymized_at')
    .eq('org_id', organizationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).filter((m) => m.anonymized_at === null);
}

/** Open invitations. Readable by managers and admins only (RLS); others get an empty list. */
export async function listPendingInvites(organizationId: string): Promise<PendingInvite[]> {
  const { data, error } = await supabase
    .from('organization_invites')
    .select('id, role, created_at, expires_at, accepted_at, revoked_at')
    .eq('organization_id', organizationId)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(({ id, role, created_at, expires_at }) => ({ id, role, created_at, expires_at }));
}

export async function seatUsage(plan: string, members: number, pendingInvites: number): Promise<SeatUsage> {
  const { data, error } = await supabase.from('plan_limits').select('max_users').eq('plan_id', plan).maybeSingle();
  if (error) throw error;
  return { members, pendingInvites, maxUsers: data?.max_users ?? null };
}

/** The shareable link. The token rides in the fragment so it never reaches a server log. */
export function inviteLink(token: string): string {
  return `${config.app.url}/auth/signup#invite=${token}`;
}

export async function createInvite(role: Exclude<UserRole, 'admin'>): Promise<{ link: string; expiresAt: string }> {
  const { data, error } = await supabase.rpc('create_invite', {
    p_role: role,
    p_valid_hours: config.team.inviteValidHours,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.token) throw new Error('The invitation was not created.');
  return { link: inviteLink(row.token), expiresAt: row.expires_at };
}

export async function revokeInvite(inviteId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_invite', { p_invite_id: inviteId });
  if (error) throw error;
}

export async function changeRole(profileId: string, role: UserRole): Promise<void> {
  const { error } = await supabase.from('profiles').update({ role }).eq('id', profileId);
  if (error) throw error;
}

/**
 * Remove a member. Their past inspections stay (the inspector name is a point-in-time snapshot and
 * the foreign key is SET NULL), because those records are legally retained.
 */
export async function removeMember(profileId: string): Promise<void> {
  const { error, count } = await supabase.from('profiles').delete({ count: 'exact' }).eq('id', profileId);
  if (error) throw error;
  // RLS turns a forbidden delete into "0 rows", not an error. Say so instead of pretending.
  if (!count) throw new Error('That member could not be removed.');
  // One seat fewer on a per-user plan (best effort; the webhook re-syncs before renewal).
  void requestSeatSync();
}

export const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'Administrator',
  manager: 'Manager',
  technician: 'Technician',
};
