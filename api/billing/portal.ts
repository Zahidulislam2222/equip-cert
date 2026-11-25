import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { config, serverConfig } from '../../src/lib/config';
import { errorText } from '../../src/lib/error-text';
import { limiterFor } from '../../src/lib/server-rate-limit';
import { clientIpOf, identifyCaller } from '../../src/lib/server-auth';
import { stripeKeyAllowed } from '../../src/lib/billing';

/**
 * Open the Stripe customer portal (switch plan, update card, cancel — seats are server-managed) for the caller's
 * organisation. Admin only. Whatever the customer changes there reaches the database through the
 * signed webhook, never through this handler.
 */
const limiter = limiterFor(serverConfig.stripe.rateWindowMs);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const ip = clientIpOf(req.headers['x-forwarded-for']);
  if ((await limiter.hit(`portal-ip:${ip}`, serverConfig.stripe.rateLimit * 5)).limited) {
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }

  const who = await identifyCaller(req.headers.authorization);
  if (!who.ok) return res.status(who.status).json({ error: who.error });
  if (who.caller.role !== 'admin') return res.status(403).json({ error: 'Only an administrator can manage billing.' });
  if ((await limiter.hit(`portal-user:${who.caller.userId}`, serverConfig.stripe.rateLimit)).limited) {
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }

  const { secretKey, allowLiveKeys } = serverConfig.stripe;
  const serviceKey = serverConfig.supabase.serviceRoleKey;
  if (!secretKey || !serviceKey || !stripeKeyAllowed(secretKey, allowLiveKeys)) {
    return res.status(503).json({ error: 'Billing is not configured.' });
  }

  const service = createClient(config.supabase.url, serviceKey, { auth: { persistSession: false } });
  const { data: org } = await service
    .from('organizations')
    .select('stripe_customer_id')
    .eq('id', who.caller.organizationId)
    .single();
  if (!org?.stripe_customer_id) {
    return res.status(409).json({ error: 'There is no billing account yet. Upgrade first.' });
  }

  try {
    const stripe = new Stripe(secretKey);
    // This project's own portal configuration, never the account default — the Stripe account may
    // be shared with other projects (scripts/stripe-sync-prices.mjs creates it with this tag).
    const configs = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
    const ours = configs.data.find((c) => c.metadata?.project === serverConfig.stripe.priceLookupPrefix);
    if (!ours) {
      console.error('Portal: no customer-portal configuration tagged for this project. Run scripts/stripe-sync-prices.mjs --apply.');
      return res.status(503).json({ error: 'Billing is not configured.' });
    }
    const session = await stripe.billingPortal.sessions.create({
      configuration: ours.id,
      customer: org.stripe_customer_id,
      return_url: `${config.app.url}/app/settings`,
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Portal error:', errorText(err));
    return res.status(502).json({ error: 'Could not open billing. Try again shortly.' });
  }
}
