import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { config, serverConfig } from '../../src/lib/config';
import { errorText } from '../../src/lib/error-text';
import { limiterFor } from '../../src/lib/server-rate-limit';
import { clientIpOf, identifyCaller } from '../../src/lib/server-auth';
import { stripeKeyAllowed } from '../../src/lib/billing';
import { currentBilling, syncSeats } from '../../src/lib/server-billing';

/**
 * Re-sync the caller's organisation's seat quantity with Stripe (pricing is per user).
 *
 * Who: any member — it is called by the person who just joined and by the admin who just removed
 * someone. What it can do: apply the CORRECT number again. The count is taken from the database
 * with the service role, never from the request, so there is nothing to tamper with. The webhook
 * also syncs on every subscription event and before each renewal (invoice.upcoming), so a client
 * that never calls this cannot keep its seats under-billed past the next invoice.
 */
const limiter = limiterFor(serverConfig.stripe.rateWindowMs);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const ip = clientIpOf(req.headers['x-forwarded-for']);
  if ((await limiter.hit(`seats-ip:${ip}`, serverConfig.stripe.rateLimit * 5)).limited) {
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }
  const who = await identifyCaller(req.headers.authorization);
  if (!who.ok) return res.status(who.status).json({ error: who.error });
  const { caller } = who;
  if ((await limiter.hit(`seats-user:${caller.userId}`, serverConfig.stripe.rateLimit)).limited) {
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }

  const { secretKey, allowLiveKeys, priceLookupPrefix } = serverConfig.stripe;
  const serviceKey = serverConfig.supabase.serviceRoleKey;
  // No billing configured: nothing to sync, and nothing is wrong.
  if (!secretKey || !serviceKey || !stripeKeyAllowed(secretKey, allowLiveKeys)) {
    return res.status(200).json({ synced: false, reason: 'billing-not-configured' });
  }

  const stripe = new Stripe(secretKey);
  const service = createClient(config.supabase.url, serviceKey, { auth: { persistSession: false } });
  try {
    const { data: org, error } = await service
      .from('organizations')
      .select('id, stripe_customer_id')
      .eq('id', caller.organizationId)
      .single();
    if (error || !org) throw error ?? new Error('Organisation not found');
    if (!org.stripe_customer_id) return res.status(200).json({ synced: false, reason: 'no-subscription' });

    const billing = await currentBilling(stripe, priceLookupPrefix, org.stripe_customer_id);
    if (!billing.subscription) return res.status(200).json({ synced: false, reason: 'no-subscription' });

    const result = await syncSeats(stripe, service, org.id, billing.subscription);
    return res.status(200).json({ synced: true, seats: result?.to ?? null });
  } catch (err) {
    console.error('Seat sync error:', errorText(err));
    return res.status(502).json({ error: 'Could not update seats right now.' });
  }
}
