import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { config, serverConfig } from '../../src/lib/config';
import { readRawBody, RawBodyUnavailableError } from '../../src/lib/webhook-body';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { secretKey, webhookSecret } = serverConfig.stripe;
  const supabaseUrl = config.supabase.url;
  const supabaseServiceKey = serverConfig.supabase.serviceRoleKey;

  if (!secretKey || !webhookSecret || !supabaseUrl || !supabaseServiceKey) {
    // Names only, never values. A placeholder copied from .env.example counts as unset (DEF-003).
    if (serverConfig.placeholderSecrets.length > 0) {
      console.error('Placeholder secrets configured:', serverConfig.placeholderSecrets.join(', '));
    }
    return res.status(500).json({ error: 'Stripe or Supabase not configured' });
  }

  const stripe = new Stripe(secretKey);
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const sig = req.headers['stripe-signature'];
  if (typeof sig !== 'string' || sig.length === 0) {
    return res.status(400).json({ error: 'Missing signature' });
  }

  // The exact bytes Stripe signed — never `req.body`, which Vercel JSON-parses (DEF-008).
  let rawBody: Buffer;
  try {
    rawBody = await readRawBody(req);
  } catch (err: unknown) {
    if (err instanceof RawBodyUnavailableError) {
      // Loud: this is a wiring fault (the route lost its raw-body handling), not a bad request,
      // and Stripe would otherwise retry into the same silent 400 that DEF-008 was.
      console.error('Stripe webhook misconfigured:', err.message);
      return res.status(400).json({ error: 'Invalid signature' });
    }
    throw err;
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err: unknown) {
    // The message only: Stripe's error object carries the whole payload, customer data included.
    console.error('Webhook signature verification failed:', err instanceof Error ? err.message : 'unknown error');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;

        // Update organization plan
        await supabase
          .from('organizations')
          .update({
            plan: 'pro',
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
          })
          .eq('stripe_customer_id', customerId);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const plan = subscription.items.data[0]?.price?.lookup_key || 'pro';

        await supabase
          .from('organizations')
          .update({ plan })
          .eq('stripe_subscription_id', subscription.id);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;

        await supabase
          .from('organizations')
          .update({ plan: 'free', stripe_subscription_id: null })
          .eq('stripe_subscription_id', subscription.id);
        break;
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook processing error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
