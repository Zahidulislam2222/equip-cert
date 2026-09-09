// Plan / pricing product data — THE single source of truth.
//
// Both the marketing landing page and the billing logic read from here. Changing a price,
// a limit, or a feature bullet is a one-file edit; nothing may re-declare these values.
// Kept free of Stripe SDK imports so the marketing bundle does not pull in stripe-js.

export const CURRENCY_SYMBOL = '$';

export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    period: 'forever',
    description: 'For solo inspectors getting started',
    cta: 'Get Started',
    highlighted: false,
    limits: {
      users: 1,
      inspectionsPerMonth: 10,
      aiAnalysesPerMonth: 5,
    },
    features: ['1 user', '10 inspections/month', '5 AI analyses/month', 'Basic PDF reports'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 29,
    period: '/user/mo',
    description: 'For teams that need full compliance',
    cta: 'Start Free Trial',
    highlighted: true,
    limits: {
      users: Infinity,
      inspectionsPerMonth: Infinity,
      aiAnalysesPerMonth: Infinity,
    },
    features: ['Unlimited inspections', 'Unlimited AI analysis', 'Corrective actions', 'Digital signatures', 'Scheduling', 'Priority support'],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    price: 79,
    period: '/user/mo',
    description: 'For organizations at scale',
    cta: 'Contact Sales',
    highlighted: false,
    limits: {
      users: Infinity,
      inspectionsPerMonth: Infinity,
      aiAnalysesPerMonth: Infinity,
    },
    features: ['Everything in Pro', 'SSO / SAML', 'API access', 'Custom branding', 'Multi-site analytics', 'Dedicated support'],
  },
} as const;

export type PlanId = keyof typeof PLANS;

/** Display order for pricing tables. */
export const PLAN_ORDER: readonly PlanId[] = ['free', 'pro', 'enterprise'] as const;

/** Formatted price for display, e.g. "$29". */
export function formatPlanPrice(planId: PlanId): string {
  return `${CURRENCY_SYMBOL}${PLANS[planId].price}`;
}

export function canAccess(
  orgPlan: string,
  feature: 'corrective_actions' | 'signatures' | 'scheduling' | 'team' | 'reports' | 'api'
): boolean {
  const gatedFeatures: Record<string, PlanId[]> = {
    corrective_actions: ['pro', 'enterprise'],
    signatures: ['pro', 'enterprise'],
    scheduling: ['pro', 'enterprise'],
    team: ['pro', 'enterprise'],
    reports: ['pro', 'enterprise'],
    api: ['enterprise'],
  };

  const allowed = gatedFeatures[feature];
  if (!allowed) return true;
  return allowed.includes(orgPlan as PlanId);
}
