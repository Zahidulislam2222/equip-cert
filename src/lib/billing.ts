// Billing logic shared by the checkout, portal and webhook handlers — pure, no I/O, unit-tested.
//
// Stripe is the source of truth for what a customer pays for. The database `organizations.plan`
// is a cache of it, written ONLY by the webhook handler with the service role (the
// guard_organization_billing trigger refuses everyone else — DEF-077).

import { PLANS, type PlanId } from './plans';

/** Stripe price lookup key for a plan, e.g. `equipcert_pro_monthly`. */
export function lookupKeyFor(prefix: string, plan: PlanId): string {
  return `${prefix}_${plan}_monthly`;
}

/** The plan a lookup key names, or null when it is not one of this project's keys. */
export function planFromLookupKey(prefix: string, key: string | null | undefined): PlanId | null {
  if (!key) return null;
  const match = key.match(/^(.+)_([a-z]+)_monthly$/);
  if (!match || match[1] !== prefix) return null;
  const plan = match[2];
  return Object.prototype.hasOwnProperty.call(PLANS, plan) ? (plan as PlanId) : null;
}

// Statuses that keep the paid plan. `past_due` keeps it through Stripe's retry window; the plan
// drops when Stripe gives up and moves the subscription to `canceled` / `unpaid`.
const PAID_STATUSES = new Set(['active', 'trialing', 'past_due']);

export interface SubscriptionLike {
  id?: string;
  status: string;
  created?: number;
  items: { data: { price?: { lookup_key?: string | null } | null }[] };
}

const PLAN_RANK: Record<PlanId, number> = { free: 0, pro: 1, enterprise: 2 };

/**
 * The plan an organisation is on given ALL of its customer's subscriptions — the highest plan
 * among those still being paid for (newest wins a tie) — plus how many are paid.
 *
 * Deriving it from one event's subscription let a late "deleted" for an old or duplicate
 * subscription downgrade an organisation that was still paying on another one (review
 * 2026-11-25). The whole set is the state; any single event is only a hint that it changed.
 */
export function pickPaidSubscription<S extends SubscriptionLike>(
  prefix: string,
  subs: readonly S[]
): { plan: PlanId; subscription: S | null; paidCount: number } {
  let best: S | null = null;
  let bestPlan: PlanId = 'free';
  let paidCount = 0;
  for (const sub of subs) {
    const plan = planFromSubscription(prefix, sub);
    if (plan === 'free') continue;
    paidCount += 1;
    const better =
      PLAN_RANK[plan] > PLAN_RANK[bestPlan] ||
      (PLAN_RANK[plan] === PLAN_RANK[bestPlan] && (sub.created ?? 0) > (best?.created ?? 0));
    if (better) {
      best = sub;
      bestPlan = plan;
    }
  }
  return { plan: bestPlan, subscription: best, paidCount };
}

/** Seats billed for a member count: at least one. */
export function seatQuantity(activeMembers: number | null | undefined): number {
  return Math.max(1, activeMembers ?? 1);
}

/** The plan an organisation should be on given its subscription (or none). */
export function planFromSubscription(prefix: string, sub: SubscriptionLike | null): PlanId {
  if (!sub || !PAID_STATUSES.has(sub.status)) return 'free';
  for (const item of sub.items.data) {
    const plan = planFromLookupKey(prefix, item.price?.lookup_key);
    if (plan && plan !== 'free') return plan;
  }
  // A paid subscription to a price we do not recognise grants nothing — never default upwards.
  return 'free';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A value usable as an organisation id, or null. Webhook metadata is not trusted blindly. */
export function asOrganizationId(value: unknown): string | null {
  return typeof value === 'string' && UUID_RE.test(value) ? value.toLowerCase() : null;
}

/** Event types the webhook acts on. Everything else is acknowledged and ignored. */
export const HANDLED_EVENTS = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  // Sent a few days before each renewal: the server-side backstop that bills the CURRENT member
  // count even if no client ever asked for a seat sync.
  'invoice.upcoming',
]);

/** Plans that may be bought self-serve (configured), intersected with the real plan list. */
export function isSelfServePlan(selfServe: readonly string[], plan: unknown): plan is PlanId {
  return (
    typeof plan === 'string' &&
    plan !== 'free' &&
    selfServe.includes(plan) &&
    Object.prototype.hasOwnProperty.call(PLANS, plan)
  );
}

/** A live key moves real money; refuse it unless explicitly allowed (Rule 5). */
export function stripeKeyAllowed(secretKey: string, allowLive: boolean): boolean {
  if (secretKey.startsWith('sk_test_') || secretKey.startsWith('rk_test_')) return true;
  return allowLive && (secretKey.startsWith('sk_live_') || secretKey.startsWith('rk_live_'));
}
