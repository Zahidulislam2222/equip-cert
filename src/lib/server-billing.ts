// Server-only Stripe helpers shared by the webhook and the billing endpoints. Never imported by
// client code: it needs the Stripe secret key and the service-role database client.
import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { pickPaidSubscription, seatQuantity } from './billing';
import type { PlanId } from './plans';

/** Every subscription of a customer, newest first, enough for any real organisation. */
export async function subscriptionsOf(stripe: Stripe, customerId: string): Promise<Stripe.Subscription[]> {
  const list = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 20 });
  return list.data;
}

/** The plan and governing subscription for a customer, from the whole subscription set. */
export async function currentBilling(
  stripe: Stripe,
  prefix: string,
  customerId: string
): Promise<{ plan: PlanId; subscription: Stripe.Subscription | null; paidCount: number }> {
  return pickPaidSubscription(prefix, await subscriptionsOf(stripe, customerId));
}

/**
 * Expire every OPEN checkout session of this customer except `keepId`, so at most one can still be
 * paid. Two tabs (or a double click) each pass the "no subscription yet" check before either is
 * paid; without this both sessions could be completed — two subscriptions, two charges (review 2,
 * 2026-11-25). If two requests race, each may expire the other's: both fail safe, the admin retries.
 * Returns how many were expired.
 */
export async function expireOtherOpenCheckouts(
  stripe: Stripe,
  customerId: string,
  keepId: string
): Promise<number> {
  const open = await stripe.checkout.sessions.list({ customer: customerId, status: 'open', limit: 20 });
  let expired = 0;
  for (const session of open.data) {
    if (session.id === keepId) continue;
    try {
      await stripe.checkout.sessions.expire(session.id);
      expired += 1;
    } catch {
      // Completed or expired between list and expire: nothing left to stop.
    }
  }
  return expired;
}

/**
 * Make the subscription's seat quantity equal the organisation's active members (pricing is per
 * user). Counted here, with the service role — never taken from the caller — so the worst a
 * caller can do is ask for a correct number to be applied again.
 */
export async function syncSeats(
  stripe: Stripe,
  service: SupabaseClient,
  organizationId: string,
  subscription: Stripe.Subscription
): Promise<{ from: number; to: number } | null> {
  const item = subscription.items.data[0];
  if (!item) return null;
  const { count, error } = await service
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', organizationId)
    .is('anonymized_at', null);
  if (error) throw error;
  const to = seatQuantity(count);
  const from = item.quantity ?? 1;
  if (from !== to) {
    await stripe.subscriptionItems.update(item.id, { quantity: to, proration_behavior: 'create_prorations' });
  }
  return { from, to };
}
