'use client';

import { useState } from 'react';
import { Building2, Link2, Loader2, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from './AuthProvider';
import { acceptInvite, parseInviteInput, provisionAccount } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

/**
 * Shown to a signed-in account that belongs to no organisation: someone who signed up from an
 * invitation link on another device, whose invitation expired, or whose account predates the
 * atomic signup (DEF-045). Two honest choices — join a team, or start one.
 */
export function OnboardingPanel() {
  const { user, onboardingError, refreshProfile, signOut } = useAuth();
  const [inviteInput, setInviteInput] = useState('');
  const [orgName, setOrgName] = useState('');
  const [busy, setBusy] = useState<'join' | 'create' | null>(null);
  const [error, setError] = useState<string | null>(onboardingError);

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = parseInviteInput(inviteInput);
    if (!token) {
      setError('Paste the whole invitation link you were sent.');
      return;
    }
    setBusy('join');
    setError(null);
    try {
      await acceptInvite(token);
      await refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join with that invitation.');
    } finally {
      setBusy(null);
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgName.trim()) return;
    setBusy('create');
    setError(null);
    try {
      // The organisation name goes through the account's own metadata so provision_account()
      // takes no arguments a caller could tamper with.
      const { error: metaError } = await supabase.auth.updateUser({ data: { org_name: orgName.trim() } });
      if (metaError) throw metaError;
      await provisionAccount();
      await refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the organisation.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-lg space-y-6 rounded-xl border border-border bg-card p-6 shadow-card">
        <div>
          <h1 className="text-step-2 font-bold font-display text-foreground">Finish setting up</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {user?.email} is signed in but not part of an organisation yet.
          </p>
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
            {error}
          </p>
        )}

        <form onSubmit={join} className="space-y-2">
          <label htmlFor="invite" className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Link2 className="h-4 w-4" aria-hidden /> Join your team
          </label>
          <input
            id="invite"
            value={inviteInput}
            onChange={(e) => setInviteInput(e.target.value)}
            placeholder="Paste the invitation link from your administrator"
            className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            autoComplete="off"
          />
          <Button type="submit" className="w-full" disabled={busy !== null}>
            {busy === 'join' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : 'Join organisation'}
          </Button>
        </form>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={create} className="space-y-2">
          <label htmlFor="org" className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Building2 className="h-4 w-4" aria-hidden /> Start a new organisation
          </label>
          <input
            id="org"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            maxLength={200}
            placeholder="Company name"
            className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <Button type="submit" variant="outline" className="w-full" disabled={busy !== null || !orgName.trim()}>
            {busy === 'create' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : 'Create organisation'}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => signOut()}
          className="flex min-h-6 items-center gap-2 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          <LogOut className="h-4 w-4" aria-hidden /> Sign out
        </button>
      </div>
    </main>
  );
}
