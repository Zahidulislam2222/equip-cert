/**
 * Billing end to end (E2E pass 2026-11-25): the REAL server bundle (deploy/generated/server.cjs)
 * against the LOCAL database and the Stripe TEST-mode API.
 *
 *   checkout -> (payment simulated in Stripe test mode) -> signed webhook -> plan + seats
 *   -> duplicate webhook -> member joins -> seat sync -> second checkout refused -> portal
 *   -> a late "deleted" for an old subscription -> cancellation -> free
 *
 * Stripe cannot reach this machine, so webhooks are signed locally with a per-run secret given to
 * the server (exactly what Stripe does with the endpoint's secret). Everything in Stripe is TEST
 * mode (free) and tagged; the customer is deleted at the end. Skipped when no `sk_test_` key is
 * configured (CI has none), and never runs with a live key.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import Stripe from 'stripe';
import { ROOT, processEnv, loadEnvLocal, env } from '../../scripts/lib/ops-env.mjs';
import { admin, stack, userWithSession, RUN } from './stack.mjs';
import { BILLING_PORT, BILLING_BASE_URL } from './settings.mjs';

loadEnvLocal();
const KEY = env('STRIPE_SECRET_KEY') ?? '';
const SKIP = /^sk_test_[A-Za-z0-9]{20,}$/.test(KEY) ? false : 'no Stripe TEST key in .env.local (CI has none)';
const PORT = BILLING_PORT;
const BASE = BILLING_BASE_URL;
const WEBHOOK_SECRET = `whsec_${randomBytes(24).toString('hex')}`;
const stripe = SKIP ? null : new Stripe(KEY);

let server;
let log = ''; // server output; its error lines are printed after the run
let owner;
let orgId;
let customerId;
const subs = [];

async function call(path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const tokenOf = async (u) => (await u.client.auth.getSession()).data.session.access_token;

let eventSeq = 0;
async function webhook(type, object) {
  eventSeq += 1;
  const payload = JSON.stringify({ id: `evt_local${RUN}${eventSeq}`, object: 'event', type, data: { object } });
  return sendSigned(payload);
}
async function sendSigned(payload) {
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const res = await fetch(`${BASE}/api/webhooks/stripe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': header },
    body: payload,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function paidSubscription(quantity = 1) {
  const price = (await stripe.prices.list({ lookup_keys: ['equipcert_pro_monthly'], active: true, limit: 1 })).data[0];
  assert.ok(price, 'run scripts/stripe-sync-prices.mjs --apply first');
  const sub = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: price.id, quantity }],
    metadata: { organization_id: orgId, plan: 'pro', e2e: RUN },
    expand: ['items.data.price'],
  });
  subs.push(sub.id);
  return sub;
}

const orgRow = async () =>
  (await admin.from('organizations').select('plan, stripe_customer_id, stripe_subscription_id').eq('id', orgId).single()).data;

describe('billing end to end (Stripe TEST mode, local database, real server bundle)', { skip: SKIP }, () => {
  before(async () => {
    const built = spawnSync('npm run build:server --silent', { cwd: ROOT, shell: true, stdio: 'inherit' });
    assert.equal(built.status, 0, 'build:server');
    server = spawn(process.execPath, ['deploy/generated/server.cjs'], {
      cwd: ROOT,
      env: {
        ...processEnv(),
        NEXT_PUBLIC_SUPABASE_URL: stack.url,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: stack.anonKey,
        SUPABASE_SERVICE_ROLE_KEY: stack.serviceKey,
        NEXT_PUBLIC_APP_URL: BASE,
        SELF_HOST_PORT: String(PORT),
        STRIPE_SECRET_KEY: KEY,
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
        STRIPE_ALLOW_LIVE_KEYS: '',
        OPENROUTER_API_KEY: '',
        RATE_LIMIT_REDIS_URL: '',
        RATE_LIMIT_REDIS_TOKEN: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout.on('data', (d) => (log += d));
    server.stderr.on('data', (d) => (log += d));
    for (let i = 0; i < 60; i += 1) {
      try {
        if ((await fetch(`${BASE}/healthz`)).ok) break;
      } catch {
        // starting
      }
      await new Promise((r) => setTimeout(r, 250));
      if (i === 59) throw new Error(`server did not start\n${log}`);
    }

    owner = await userWithSession('billing-owner', { full_name: 'Billing Owner', org_name: `Billing Co ${RUN}` });
    ({ data: orgId } = await owner.client.rpc('provision_account'));
    assert.ok(orgId);
  });

  after(async () => {
    server?.kill();
    const errors = log.split('\n').filter((l) => /error/i.test(l));
    if (errors.length) console.log(`--- server error lines ---\n${errors.join('\n')}`);
    if (customerId) await stripe.customers.del(customerId).catch(() => {}); // cancels its subscriptions too
  });

  it('refuses Enterprise self-serve and non-admins', async () => {
    const t = await tokenOf(owner);
    assert.equal((await call('/api/billing/checkout', t, { plan: 'enterprise' })).status, 400);
    assert.equal((await call('/api/billing/checkout', null, { plan: 'pro' })).status, 401);
  });

  it('checkout creates ONE customer, and a second checkout expires the first session', async () => {
    const t = await tokenOf(owner);
    const first = await call('/api/billing/checkout', t, { plan: 'pro' });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.match(first.body.url, /^https:\/\/checkout\.stripe\.com\//);
    customerId = (await orgRow()).stripe_customer_id;
    assert.match(customerId, /^cus_/);
    await stripe.customers.update(customerId, { metadata: { e2e: RUN } });

    const second = await call('/api/billing/checkout', t, { plan: 'pro' });
    assert.equal(second.status, 200);
    assert.equal((await orgRow()).stripe_customer_id, customerId, 'no second customer');
    const open = await stripe.checkout.sessions.list({ customer: customerId, status: 'open', limit: 10 });
    assert.equal(open.data.length, 1, 'exactly one checkout session can still be paid');
  });

  it('a paid subscription + signed webhook moves the organisation to Pro', async () => {
    await stripe.paymentMethods.attach('pm_card_visa', { customer: customerId }).then((pm) =>
      stripe.customers.update(customerId, { invoice_settings: { default_payment_method: pm.id } })
    );
    const sub = await paidSubscription(1);
    assert.equal(sub.status, 'active');
    const r = await webhook('customer.subscription.created', sub);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(await orgRow(), { plan: 'pro', stripe_customer_id: customerId, stripe_subscription_id: sub.id });
  });

  it('the same event delivered twice is applied once', async () => {
    const payload = JSON.stringify({ id: `evt_local${RUN}dup`, object: 'event', type: 'customer.subscription.updated', data: { object: { id: subs[0], object: 'subscription', metadata: { organization_id: orgId } } } });
    assert.equal((await sendSigned(payload)).body.duplicate, undefined);
    assert.equal((await sendSigned(payload)).body.duplicate, true);
  });

  it('a bad signature is refused', async () => {
    const res = await fetch(`${BASE}/api/webhooks/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=00' },
      body: '{}',
    });
    assert.equal(res.status, 400);
  });

  it('a member who joins is billed as a seat (server-counted)', async () => {
    const { data } = await owner.client.rpc('create_invite', { p_role: 'technician', p_valid_hours: 24 });
    const token = (Array.isArray(data) ? data[0] : data).token;
    const member = await userWithSession('billing-member', { full_name: 'Billing Member' });
    assert.equal((await member.client.rpc('accept_invite', { p_token: token })).error, null);
    const r = await call('/api/billing/seats', await tokenOf(member));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body, { synced: true, seats: 2 });
    const item = (await stripe.subscriptions.retrieve(subs[0])).items.data[0];
    assert.equal(item.quantity, 2);
  });

  it('a second checkout while subscribed is refused (409)', async () => {
    assert.equal((await call('/api/billing/checkout', await tokenOf(owner), { plan: 'pro' })).status, 409);
  });

  it('the portal opens for the admin', async () => {
    const r = await call('/api/billing/portal', await tokenOf(owner));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body.url, /^https:\/\/billing\.stripe\.com\//);
  });

  it('a late "deleted" for an old subscription does not downgrade a paying organisation', async () => {
    const newer = await paidSubscription(2);
    const old = await stripe.subscriptions.cancel(subs[0]);
    const r = await webhook('customer.subscription.deleted', old);
    assert.equal(r.status, 200);
    const row = await orgRow();
    assert.equal(row.plan, 'pro');
    assert.equal(row.stripe_subscription_id, newer.id);
  });

  it('cancelling the last subscription returns the organisation to Free', async () => {
    const last = await stripe.subscriptions.cancel(subs[1]);
    assert.equal((await webhook('customer.subscription.deleted', last)).status, 200);
    assert.deepEqual(await orgRow(), { plan: 'free', stripe_customer_id: customerId, stripe_subscription_id: null });
  });
});
