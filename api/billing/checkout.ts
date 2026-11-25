import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { config, serverConfig } from '../../src/lib/config';
import { limiterFor } from '../../src/lib/server-rate-limit';
import { clientIpOf, identifyCaller } from '../../src/lib/server-auth';
import { isSelfServePlan, lookupKeyFor, seatQuantity, stripeKeyAllowed } from '../../src/lib/billing';
import { currentBilling, expireOtherOpenCheckouts } from '../../src/lib/server-billing';

/**
 * Start a Stripe Checkout session for the caller's organisation.
 *
 * Who: an ADMIN of the organisation (checked against the database, not the request).
 * What: a subscription to a self-serve plan, priced by lookup key, one seat per active member.
 * The plan itself is NOT changed here — only the verified webhook does that, after Stripe confirms
 * payment. A forged success redirect therefore buys nothing.
 */
const limiter = limiterFor(serverConfig.stripe.rateWindowMs);
const bodySchema = z.object({ plan: z.string().max(40) });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const ip = clientIpOf(req.headers['x-forwarded-for']);
  if ((await limiter.hit(`billing-ip:${ip}`, serverConfig.stripe.rateLimit * 5)).limited) {
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }

  const who = await identifyCaller(req.headers.authorization);
  if (!who.ok) return res.status(who.status).json({ error: who.error });
  const { caller } = who;
  if (caller.role !== 'admin') return res.status(403).json({ error: 'Only an administrator can change the plan.' });
  if ((await limiter.hit(`billing-user:${caller.userId}`, serverConfig.stripe.rateLimit)).limited) {
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success || !isSelfServePlan(serverConfig.stripe.selfServePlans, parsed.data.plan)) {
    return res.status(400).json({ error: 'That plan cannot be bought online. Contact sales for Enterprise.' });
  }
  const plan = parsed.data.plan;

  const { secretKey, allowLiveKeys, priceLookupPrefix } = serverConfig.stripe;
  const serviceKey = serverConfig.supabase.serviceRoleKey;
  if (!secretKey || !serviceKey) return res.status(503).json({ error: 'Billing is not configured.' });
  if (!stripeKeyAllowed(secretKey, allowLiveKeys)) {
    console.error('Billing refused: a live Stripe key is configured without STRIPE_ALLOW_LIVE_KEYS=true.');
    return res.status(503).json({ error: 'Billing is not configured.' });
  }

  const stripe = new Stripe(secretKey);
  const service = createClient(config.supabase.url, serviceKey, { auth: { persistSession: false } });

  try {
    const { data: org, error: orgError } = await service
      .from('organizations')
      .select('id, name, plan, stripe_customer_id, stripe_subscription_id')
      .eq('id', caller.organizationId)
      .single();
    if (orgError || !org) throw orgError ?? new Error('Organisation not found');

    if (org.plan === plan && org.stripe_subscription_id) {
      return res.status(409).json({ error: 'You are already on this plan. Use "Manage billing" to change it.' });
    }
    // Ask Stripe, not only the cached column: the webhook may not have landed yet, and a second
    // checkout would create a second subscription for the same organisation.
    if (org.stripe_customer_id) {
      const existing = await currentBilling(stripe, priceLookupPrefix, org.stripe_customer_id);
      if (existing.subscription) {
        return res.status(409).json({ error: 'This organisation already has a subscription. Use "Manage billing" to change it.' });
      }
    }

    const lookupKey = lookupKeyFor(priceLookupPrefix, plan);
    const prices = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
    const price = prices.data[0];
    if (!price) {
      console.error(`Billing: no active Stripe price with lookup key ${lookupKey}. Run scripts/stripe-sync-prices.mjs.`);
      return res.status(503).json({ error: 'Billing is not configured.' });
    }

    let customerId = org.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create(
        { name: org.name, email: caller.email ?? undefined, metadata: { organization_id: org.id } },
        // Two clicks must not create two customers for one organisation.
        { idempotencyKey: `equipcert-customer-${org.id}` }
      );
      customerId = customer.id;
      const { error: saveError } = await service
        .from('organizations')
        .update({ stripe_customer_id: customerId })
        .eq('id', org.id)
        .is('stripe_customer_id', null);
      if (saveError) throw saveError;
    }

    const { count } = await service
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', org.id)
      .is('anonymized_at', null);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: org.id,
      line_items: [{ price: price.id, quantity: seatQuantity(count) }],
      metadata: { organization_id: org.id, plan },
      subscription_data: { metadata: { organization_id: org.id, plan } },
      success_url: `${config.app.url}/app/settings?billing=success`,
      cancel_url: `${config.app.url}/app/settings?billing=cancelled`,
      allow_promotion_codes: false,
    });

    // Only the newest checkout may be paid: an older tab's session is expired now.
    await expireOtherOpenCheckouts(stripe, customerId, session.id);

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err instanceof Error ? err.message : 'unknown error');
    return res.status(502).json({ error: 'Could not start checkout. Try again shortly.' });
  }
}
