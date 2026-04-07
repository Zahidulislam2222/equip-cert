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

// Plan definitions — single source of truth
export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
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
    limits: {
      users: Infinity,
      inspectionsPerMonth: Infinity,
      aiAnalysesPerMonth: Infinity,
    },
    features: ['Everything in Pro', 'SSO / SAML', 'API access', 'Custom branding', 'Multi-site analytics', 'Dedicated support'],
  },
} as const;

export type PlanId = keyof typeof PLANS;

export function canAccess(orgPlan: string, feature: 'corrective_actions' | 'signatures' | 'scheduling' | 'team' | 'reports' | 'api'): boolean {
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
