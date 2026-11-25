'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { CreditCard, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth/AuthProvider';
import { supabase } from '@/lib/supabase';
import { PLANS, formatPlanPrice, type PlanId } from '@/lib/plans';

// ?billing=success|cancelled after Stripe redirects back. Read as an external store so the
// prerendered HTML and the first client render agree.
const subscribeNoop = () => () => {};
const readBillingParam = () => new URLSearchParams(window.location.search).get('billing');

async function startBillingSession(path: '/api/billing/checkout' | '/api/billing/portal', body?: object) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Your session has expired. Sign in again.');
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body ?? {}),
  });
  const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !json.url) throw new Error(json.error || 'Billing is unavailable right now.');
  // Stripe-hosted pages only — never follow a URL that is not Stripe's.
  const target = new URL(json.url);
  if (target.protocol !== 'https:' || !/(^|\.)stripe\.com$/.test(target.hostname)) {
    throw new Error('Unexpected billing address; not opened.');
  }
  window.location.assign(target.toString());
}

/**
 * Plan and billing. Test mode: payments use Stripe test cards and move no money. The plan shown
 * changes only after Stripe's signed webhook arrives — a success redirect alone changes nothing.
 */
export function BillingCard() {
  const { profile, organization, refreshProfile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const plan = (organization?.plan ?? 'free') as PlanId;
  const [busy, setBusy] = useState<'checkout' | 'portal' | null>(null);
  const billingParam = useSyncExternalStore(subscribeNoop, readBillingParam, () => null);

  // After a successful checkout the webhook usually lands within seconds; re-read the
  // organisation a few times so the new plan appears without a manual reload.
  useEffect(() => {
    if (billingParam !== 'success') return;
    toast.success('Payment received. Your plan updates as soon as Stripe confirms it.');
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      void refreshProfile();
      if (tries >= 6) window.clearInterval(timer);
    }, 2_500);
    return () => window.clearInterval(timer);
  }, [billingParam, refreshProfile]);

  const run = async (kind: 'checkout' | 'portal') => {
    setBusy(kind);
    try {
      if (kind === 'checkout') await startBillingSession('/api/billing/checkout', { plan: 'pro' });
      else await startBillingSession('/api/billing/portal');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Billing is unavailable right now.');
      setBusy(null);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-6 shadow-card">
      <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold font-display text-foreground">
        <CreditCard className="h-5 w-5 text-primary" aria-hidden /> Plan &amp; billing
      </h3>
      <div className="space-y-4">
        <div>
          <p className="text-sm text-muted-foreground">Current plan</p>
          <p className="font-medium text-foreground">
            {PLANS[plan]?.name ?? plan}
            {plan !== 'free' && ` — ${formatPlanPrice(plan)}${PLANS[plan].period}`}
          </p>
        </div>
        {billingParam === 'cancelled' && (
          <p className="text-sm text-muted-foreground">Checkout was cancelled. Nothing was charged.</p>
        )}
        {!isAdmin ? (
          <p className="text-sm text-muted-foreground">Only an administrator can change the plan.</p>
        ) : plan === 'free' ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {PLANS.pro.name}: {PLANS.pro.features.slice(0, 3).join(', ')}. {formatPlanPrice('pro')}
              {PLANS.pro.period}.
            </p>
            <Button onClick={() => run('checkout')} disabled={busy !== null} className="h-11">
              {busy === 'checkout' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Upgrade to {PLANS.pro.name}
            </Button>
          </div>
        ) : (
          <Button variant="outline" onClick={() => run('portal')} disabled={busy !== null} className="h-11">
            {busy === 'portal' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Manage billing
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          Payments are processed by Stripe. This deployment runs in Stripe test mode: use card 4242 4242 4242 4242 — no
          real money moves.
        </p>
      </div>
    </div>
  );
}
