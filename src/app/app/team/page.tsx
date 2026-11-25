'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Link2, Loader2, Trash2, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { MotionPage } from '@/components/motion/MotionPage';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  changeRole,
  createInvite,
  listMembers,
  listPendingInvites,
  removeMember,
  revokeInvite,
  ROLE_LABEL,
  seatUsage,
  type PendingInvite,
  type SeatUsage,
  type TeamMember,
} from '@/lib/team';
import type { UserRole } from '@/lib/db';

interface TeamState {
  members: TeamMember[];
  invites: PendingInvite[];
  seats: SeatUsage | null;
}

async function loadTeam(organizationId: string, plan: string): Promise<TeamState> {
  const [members, invites] = await Promise.all([listMembers(organizationId), listPendingInvites(organizationId)]);
  const seats = await seatUsage(plan, members.length, invites.length);
  return { members, invites, seats };
}

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

export default function TeamPage() {
  const { profile, organization } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const isManager = isAdmin || profile?.role === 'manager';

  const [state, setState] = useState<TeamState>({ members: [], invites: [], seats: null });
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inviteRole, setInviteRole] = useState<Exclude<UserRole, 'admin'>>('technician');
  const [newLink, setNewLink] = useState<{ link: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const orgId = organization?.id ?? null;
  const plan = organization?.plan ?? 'free';

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    loadTeam(orgId, plan)
      .then((next) => {
        if (!active) return;
        setState(next);
        setLoadError(null);
      })
      .catch((err) => active && setLoadError(err instanceof Error ? err.message : 'Could not load the team.'))
      .finally(() => active && setIsLoading(false));
    return () => {
      active = false;
    };
  }, [orgId, plan, version]);

  const reload = () => setVersion((v) => v + 1);

  const seatsFull =
    state.seats?.maxUsers != null && state.seats.members + state.seats.pendingInvites >= state.seats.maxUsers;

  const onCreateInvite = async () => {
    setBusyId('invite');
    try {
      setNewLink(await createInvite(inviteRole));
      setCopied(false);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the invitation.');
    } finally {
      setBusyId(null);
    }
  };

  const onCopy = async () => {
    if (!newLink) return;
    try {
      await navigator.clipboard.writeText(newLink.link);
      setCopied(true);
    } catch {
      toast.error('Copy failed — select the link and copy it manually.');
    }
  };

  const onRole = async (member: TeamMember, role: UserRole) => {
    setBusyId(member.id);
    try {
      await changeRole(member.id, role);
      toast.success(`${member.full_name} is now ${ROLE_LABEL[role].toLowerCase()}.`);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Role change refused.');
    } finally {
      setBusyId(null);
    }
  };

  const onRemove = async (member: TeamMember) => {
    const ok = window.confirm(
      `Remove ${member.full_name} from ${organization?.name}?\n\nTheir signed inspections stay on record under their name. They lose access immediately.`
    );
    if (!ok) return;
    setBusyId(member.id);
    try {
      await removeMember(member.id);
      toast.success(`${member.full_name} was removed.`);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove that member.');
    } finally {
      setBusyId(null);
    }
  };

  const onRevoke = async (invite: PendingInvite) => {
    setBusyId(invite.id);
    try {
      await revokeInvite(invite.id);
      toast.success('Invitation revoked.');
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not revoke the invitation.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <MotionPage className="space-y-6">
      <div>
        <h1 className="text-step-3 font-extrabold font-display text-foreground">Team</h1>
        <p className="text-muted-foreground">
          {isAdmin
            ? 'Invite people, set their role, and remove access.'
            : 'The people in your organisation. Only an administrator can change the team.'}
        </p>
      </div>

      {loadError && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-foreground">
          {loadError}
        </p>
      )}

      {state.seats && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {state.seats.members} member{state.seats.members === 1 ? '' : 's'}
          {state.seats.pendingInvites > 0 && `, ${state.seats.pendingInvites} invitation${state.seats.pendingInvites === 1 ? '' : 's'} open`}
          {state.seats.maxUsers != null ? ` — your plan allows ${state.seats.maxUsers}.` : ' — unlimited on your plan.'}
        </p>
      )}

      {isAdmin && (
        <section aria-labelledby="invite-heading" className="rounded-lg border border-border bg-card p-6 shadow-card space-y-4">
          <h2 id="invite-heading" className="flex items-center gap-2 text-lg font-semibold font-display text-foreground">
            <UserPlus className="h-5 w-5 text-primary" aria-hidden /> Invite a member
          </h2>
          {seatsFull ? (
            <p className="text-sm text-muted-foreground">
              Every seat on your plan is taken. Upgrade in Settings → Billing, or revoke an open invitation.
            </p>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="flex-1 space-y-1 text-sm">
                <span className="font-medium text-foreground">Role</span>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as Exclude<UserRole, 'admin'>)}
                  className="h-11 w-full rounded-lg border border-input bg-background px-3 text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="technician">{ROLE_LABEL.technician} — inspects and signs</option>
                  <option value="manager">{ROLE_LABEL.manager} — also manages equipment and schedules</option>
                </select>
              </label>
              <Button onClick={onCreateInvite} disabled={busyId !== null} className="h-11">
                {busyId === 'invite' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}
                Create invitation link
              </Button>
            </div>
          )}

          {newLink && (
            <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-4">
              <p className="text-sm font-medium text-foreground">
                Send this link to the person you are inviting. It works once and expires{' '}
                {dateFmt.format(new Date(newLink.expiresAt))}. It is shown only now.
              </p>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={newLink.link}
                  aria-label="Invitation link"
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 font-mono text-xs text-foreground"
                />
                <Button variant="outline" onClick={onCopy} className="h-10">
                  {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="members-heading" className="rounded-lg border border-border bg-card shadow-card">
        <h2 id="members-heading" className="flex items-center gap-2 border-b border-border p-6 text-lg font-semibold font-display text-foreground">
          <Users className="h-5 w-5 text-primary" aria-hidden /> Members
        </h2>
        {isLoading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading team…
          </div>
        ) : state.members.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No members found.</p>
        ) : (
          <ul className="divide-y divide-border">
            {state.members.map((m) => {
              const isSelf = m.user_id === profile?.user_id;
              return (
                <li key={m.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                  <div>
                    <p className="font-medium text-foreground">
                      {m.full_name} {isSelf && <span className="text-sm text-muted-foreground">(you)</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">Joined {dateFmt.format(new Date(m.created_at))}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {isAdmin && !isSelf ? (
                      <>
                        <label className="sr-only" htmlFor={`role-${m.id}`}>Role for {m.full_name}</label>
                        <select
                          id={`role-${m.id}`}
                          value={m.role}
                          disabled={busyId !== null}
                          onChange={(e) => onRole(m, e.target.value as UserRole)}
                          className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          {(Object.keys(ROLE_LABEL) as UserRole[]).map((r) => (
                            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                          ))}
                        </select>
                        <Button
                          variant="ghost"
                          onClick={() => onRemove(m)}
                          disabled={busyId !== null}
                          aria-label={`Remove ${m.full_name}`}
                          className="h-10 text-destructive"
                        >
                          {busyId === m.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
                        </Button>
                      </>
                    ) : (
                      <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-foreground">{ROLE_LABEL[m.role]}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {isManager && (
        <section aria-labelledby="invites-heading" className="rounded-lg border border-border bg-card shadow-card">
          <h2 id="invites-heading" className="border-b border-border p-6 text-lg font-semibold font-display text-foreground">
            Open invitations
          </h2>
          {state.invites.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No open invitations.</p>
          ) : (
            <ul className="divide-y divide-border">
              {state.invites.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3 p-4 sm:px-6">
                  <div>
                    <p className="text-sm font-medium text-foreground">{ROLE_LABEL[inv.role]}</p>
                    <p className="text-xs text-muted-foreground">
                      Created {dateFmt.format(new Date(inv.created_at))} · expires {dateFmt.format(new Date(inv.expires_at))}
                    </p>
                  </div>
                  {isAdmin && (
                    <Button variant="outline" onClick={() => onRevoke(inv)} disabled={busyId !== null} className="h-10">
                      {busyId === inv.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : 'Revoke'}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </MotionPage>
  );
}
