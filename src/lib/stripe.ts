import { loadStripe } from '@stripe/stripe-js';
import { config } from './config';

// Lazy-load Stripe to avoid loading it on pages that don't need it
let stripePromise: ReturnType<typeof loadStripe> | null = null;

export function getStripe() {
  if (!stripePromise && config.stripe.publishableKey) {
    stripePromise = loadStripe(config.stripe.publishableKey);
  }
  return stripePromise;
}

// Plan data lives in ./plans — re-exported here for existing billing call sites.
// Do not redeclare plan prices, limits, or features anywhere else.
export { PLANS, PLAN_ORDER, CURRENCY_SYMBOL, formatPlanPrice, canAccess } from './plans';
export type { PlanId } from './plans';
