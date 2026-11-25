import type { VercelRequest, VercelResponse } from '@vercel/node';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { config, serverConfig } from '../../src/lib/config';
import { readRawBody, RawBodyUnavailableError } from '../../src/lib/webhook-body';
import { asOrganizationId, HANDLED_EVENTS, planFromSubscription, stripeKeyAllowed } from '../../src/lib/billing';
import { currentBilling, syncSeats } from '../../src/lib/server-billing';

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
  if (!stripeKeyAllowed(secretKey, serverConfig.stripe.allowLiveKeys)) {
    console.error('Stripe webhook refused: a live key is configured without STRIPE_ALLOW_LIVE_KEYS=true.');
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

  // Acknowledge, and ignore, everything this integration does not act on — before touching the
  // database, so an unrelated event can never fail or retry.
  if (!HANDLED_EVENTS.has(event.type)) {
    return res.status(200).json({ received: true, ignored: event.type });
  }

  try {
    // Idempotency (Stripe delivers at least once). Every update below is a "set to the current
    // Stripe state" write, so a concurrent duplicate is harmless; this check only saves the work.
    const { data: seen, error: seenError } = await supabase
      .from('billing_events')
      .select('event_id')
      .eq('event_id', event.id)
      .maybeSingle();
    if (seenError) throw seenError;
    if (seen) return res.status(200).json({ received: true, duplicate: true });

    // Resolve the subscription and organisation this event is about.
    let subscriptionId: string | null = null;
    let organizationId: string | null = null;
    let invoiceCustomerId: string | null = null;
    if (event.type === 'invoice.upcoming') {
      // An upcoming invoice has no id and is not a subscription; its customer is enough.
      const invoice = event.data.object as Stripe.Invoice;
      invoiceCustomerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id ?? null;
    } else if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== 'subscription') return res.status(200).json({ received: true, ignored: 'mode' });
      subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id ?? null;
      organizationId = asOrganizationId(session.client_reference_id) ?? asOrganizationId(session.metadata?.organization_id);
    } else {
      const sub = event.data.object as Stripe.Subscription;
      subscriptionId = sub.id;
      organizationId = asOrganizationId(sub.metadata?.organization_id);
    }

    // Read the CURRENT subscription from Stripe rather than trusting this event's snapshot:
    // deliveries can arrive out of order, and "deleted" followed by a late "updated" must not
    // resurrect a paid plan.
    const current = subscriptionId
      ? await stripe.subscriptions.retrieve(subscriptionId).catch((err: unknown) => {
          if (err instanceof Stripe.errors.StripeInvalidRequestError && err.statusCode === 404) return null;
          throw err;
        })
      : null;
    if (!organizationId && current) organizationId = asOrganizationId(current.metadata?.organization_id);

    const customerId = current
      ? typeof current.customer === 'string' ? current.customer : current.customer.id
      : invoiceCustomerId;

    // Last resort: the customer id recorded at checkout.
    if (!organizationId && customerId) {
      const { data } = await supabase.from('organizations').select('id').eq('stripe_customer_id', customerId).maybeSingle();
      organizationId = data?.id ?? null;
    }

    if (!organizationId) {
      // Nothing to apply it to. Acknowledge (a retry cannot fix this) but say so loudly.
      console.error(`Stripe ${event.type} ${event.id}: no organisation could be resolved.`);
      return res.status(200).json({ received: true, unmatched: true });
    }

    // The plan comes from the customer's WHOLE subscription set, not this event's subscription:
    // a late "deleted" for an old or duplicate subscription must not downgrade an organisation
    // still paying on another one.
    const prefix = serverConfig.stripe.priceLookupPrefix;
    const billing = customerId
      ? await currentBilling(stripe, prefix, customerId)
      : { plan: planFromSubscription(prefix, current), subscription: current, paidCount: current ? 1 : 0 };
    const plan = billing.plan;
    const governing = plan === 'free' ? null : billing.subscription;
    if (billing.paidCount > 1) {
      console.error(
        `Stripe: organisation ${organizationId} has ${billing.paidCount} paid subscriptions — the extra one should be cancelled in Stripe.`
      );
    }
    const { data: updated, error: updateError } = await supabase
      .from('organizations')
      .update({
        plan,
        stripe_subscription_id: governing?.id ?? null,
        ...(customerId ? { stripe_customer_id: customerId } : {}),
      })
      .eq('id', organizationId)
      .select('id');
    if (updateError) throw updateError;
    if (!updated || updated.length === 0) {
      console.error(`Stripe ${event.type} ${event.id}: organisation ${organizationId} not found.`);
      return res.status(200).json({ received: true, unmatched: true });
    }

    // Per-user pricing: bill the current member count. A failure here is logged, not retried
    // through Stripe — the next subscription event or the pre-renewal invoice.upcoming syncs again.
    if (governing) {
      try {
        await syncSeats(stripe, supabase, organizationId, governing);
      } catch (err) {
        console.error(`Stripe seat sync failed for ${organizationId}:`, err instanceof Error ? err.message : 'unknown error');
      }
    }

    const { error: recordError } = await supabase
      .from('billing_events')
      .insert({ event_id: event.id, event_type: event.type, organization_id: organizationId });
    // 23505: a concurrent duplicate recorded it first — the update above was the same either way.
    if (recordError && recordError.code !== '23505') throw recordError;

    return res.status(200).json({ received: true, plan });
  } catch (err) {
    // A 500 makes Stripe retry with backoff, which is right for a transient database or API fault.
    console.error('Webhook processing error:', err instanceof Error ? err.message : 'unknown error');
    return res.status(500).json({ error: 'Internal server error' });
  }
}
