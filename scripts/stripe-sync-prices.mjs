#!/usr/bin/env node
/**
 * Make the Stripe account match src/lib/plans.ts — the single owner of prices (Rule 12).
 *
 *   node scripts/stripe-sync-prices.mjs                 # dry run: report what would change
 *   node scripts/stripe-sync-prices.mjs --apply         # create/replace prices + portal config
 *   node scripts/stripe-sync-prices.mjs --apply --webhook-url https://host/api/webhooks/stripe
 *        ...also create the webhook endpoint and write its signing secret into .env.local
 *
 * TEST MODE ONLY unless STRIPE_ALLOW_LIVE_KEYS=true: a live key moves real money (Rule 5), so this
 * refuses one by default. In test mode every call below is free.
 *
 * Prices are found by lookup key `<STRIPE_PRICE_LOOKUP_PREFIX>_<plan>_monthly`. Stripe prices are
 * immutable, so a changed amount creates a NEW price and moves the lookup key to it
 * (`transfer_lookup_key`); existing subscribers keep the old price until changed in the portal.
 *
 * Secrets are never printed. The webhook signing secret is written straight into .env.local; copy
 * it into CREDENTIALS.md and the deployment environment from there.
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import Stripe from 'stripe';
import { env, exitWith, loadEnvLocal, requireEnv, ROOT } from './lib/ops-env.mjs';

loadEnvLocal();
const apply = process.argv.includes('--apply');
const hookArg = process.argv.indexOf('--webhook-url');
const webhookUrl = hookArg > -1 ? process.argv[hookArg + 1] : null;

const key = requireEnv('STRIPE_SECRET_KEY', 'Needed to read and create prices.');
const allowLive = env('STRIPE_ALLOW_LIVE_KEYS') === 'true';
if (!/^(sk|rk)_test_/.test(key) && !allowLive) {
  exitWith('Refusing a non-test Stripe key.', 'Live keys move real money (Rule 5). Set STRIPE_ALLOW_LIVE_KEYS=true only with explicit approval.');
}
if (webhookUrl && !/^https:\/\/[a-z0-9.-]+\/api\/webhooks\/stripe$/.test(webhookUrl)) {
  exitWith('--webhook-url must be https://<host>/api/webhooks/stripe');
}

// plans.ts, billing.ts and config.ts are TypeScript; bundle them so this script reads the real
// owners (prices, handled webhook events, lookup prefix, self-serve plans), never a copy.
const dir = mkdtempSync(join(tmpdir(), 'equipcert-plans-'));
const load = async (entry, name) => {
  const outfile = join(dir, name);
  buildSync({ entryPoints: [join(ROOT, entry)], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'warning' });
  return import(pathToFileURL(outfile).href);
};
const { PLANS, PLAN_ORDER, CURRENCY_CODE } = await load('src/lib/plans.ts', 'plans.mjs');
const { HANDLED_EVENTS } = await load('src/lib/billing.ts', 'billing.mjs');
const { serverConfig } = await load('src/lib/config.ts', 'config.mjs');
rmSync(dir, { recursive: true, force: true });
const prefix = serverConfig.stripe.priceLookupPrefix;
const selfServe = serverConfig.stripe.selfServePlans;
if (!/^[a-z][a-z0-9-]{1,30}$/.test(prefix)) exitWith(`Bad STRIPE_PRICE_LOOKUP_PREFIX: ${prefix}`);

const stripe = new Stripe(key);
const tag = { project: prefix, managed_by: 'scripts/stripe-sync-prices.mjs' };
const mode = apply ? 'APPLY' : 'DRY RUN';
console.log(`Stripe sync (${mode}), prefix "${prefix}", ${key.startsWith('sk_test_') || key.startsWith('rk_test_') ? 'TEST mode' : 'LIVE mode'}`);

const priceIds = [];
for (const planId of PLAN_ORDER) {
  const plan = PLANS[planId];
  if (plan.price <= 0) continue;
  const lookupKey = `${prefix}_${planId}_monthly`;
  const amount = Math.round(plan.price * 100);
  const existing = (await stripe.prices.list({ lookup_keys: [lookupKey], active: true, expand: ['data.product'], limit: 1 })).data[0];

  if (existing && existing.unit_amount === amount && existing.currency === CURRENCY_CODE && existing.recurring?.interval === 'month') {
    console.log(`  ✓ ${lookupKey}: ${amount} ${CURRENCY_CODE}/month — up to date (${existing.id})`);
    priceIds.push({ plan: planId, price: existing.id, product: typeof existing.product === 'string' ? existing.product : existing.product.id });
    continue;
  }
  console.log(`  ${existing ? '↻ replace' : '+ create'} ${lookupKey}: ${amount} ${CURRENCY_CODE}/month per seat`);
  if (!apply) continue;

  const productId =
    existing && typeof existing.product !== 'string'
      ? existing.product.id
      : (await stripe.products.create({ name: `EquipCert ${plan.name}`, description: plan.description, metadata: { ...tag, plan: planId } })).id;
  const created = await stripe.prices.create({
    product: productId,
    unit_amount: amount,
    currency: CURRENCY_CODE,
    recurring: { interval: 'month' },
    lookup_key: lookupKey,
    transfer_lookup_key: true,
    nickname: `${plan.name} monthly (per seat)`,
    metadata: { ...tag, plan: planId },
  });
  if (existing) await stripe.prices.update(existing.id, { active: false });
  priceIds.push({ plan: planId, price: created.id, product: productId });
  console.log(`    created ${created.id}`);
}

// The customer portal needs a configuration. NOT the account default: this Stripe account may be
// shared with other projects, and the default applies to all of them. EquipCert's configuration is
// found by its metadata (api/billing/portal.ts does the same).
//
// Seats are NOT editable in the portal: pricing is per user, and the server sets the quantity to
// the real member count (src/lib/server-billing.ts). Letting an admin lower it there would let an
// organisation of fifty pay for one (review 2026-11-25). The portal may switch between the plans
// offered above, cancel at period end, update the card and show invoices.
// Only SELF-SERVE plans are offered (STRIPE_SELF_SERVE_PLANS). Enterprise has a Stripe price so a
// sales-led subscription can use it, but checkout refuses it, so the portal must not sell it either:
// otherwise a Pro admin could switch to Enterprise there (review 2, 2026-11-25).
const portalPrices = priceIds.filter(({ plan }) => selfServe.includes(plan));
const portalFeatures = {
  invoice_history: { enabled: true },
  payment_method_update: { enabled: true },
  subscription_cancel: { enabled: true, mode: 'at_period_end' },
  subscription_update: {
    enabled: true,
    default_allowed_updates: ['price'],
    proration_behavior: 'create_prorations',
    products: portalPrices.map(({ price, product }) => ({ product, prices: [price] })),
  },
};
// products are omitted from the response unless expanded, and the up-to-date check needs them.
const portalConfigs = await stripe.billingPortal.configurations.list({
  active: true,
  limit: 100,
  expand: ['data.features.subscription_update.products'],
});
const ours = portalConfigs.data.find((c) => c.metadata?.project === prefix);
if (!ours) {
  console.log(`  + create customer-portal configuration (metadata project=${prefix}, not the account default)`);
  if (apply && priceIds.length) {
    await stripe.billingPortal.configurations.create({
      business_profile: { headline: 'EquipCert billing' },
      features: portalFeatures,
      metadata: tag,
    });
  }
} else {
  const current = ours.features?.subscription_update;
  const currentPrices = (current?.products ?? []).flatMap((x) => x.prices).sort().join(',');
  const wantedPrices = portalPrices.map((x) => x.price).sort().join(',');
  const upToDate =
    (current?.default_allowed_updates ?? []).join(',') === 'price' && currentPrices === wantedPrices;
  if (upToDate) {
    console.log(`  ✓ customer-portal configuration up to date (${ours.id})`);
  } else {
    console.log(`  ~ update customer-portal configuration ${ours.id} (plan switching only; seats are server-managed)`);
    if (apply && priceIds.length) await stripe.billingPortal.configurations.update(ours.id, { features: portalFeatures });
  }
}

if (webhookUrl) {
  const events = [...HANDLED_EVENTS];
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  const match = endpoints.data.find((e) => e.url === webhookUrl);
  if (match) {
    const have = [...match.enabled_events].sort().join(',');
    const want = [...events].sort().join(',');
    if (have === want) {
      console.log(`  ✓ webhook endpoint exists for ${webhookUrl} (${match.id}) with the right events.`);
    } else {
      console.log(`  ~ update webhook endpoint ${match.id} events: ${want}`);
      if (apply) await stripe.webhookEndpoints.update(match.id, { enabled_events: events });
    }
    console.log('    Its signing secret is not retrievable again; delete the endpoint in the dashboard to rotate.');
  } else {
    console.log(`  + create webhook endpoint ${webhookUrl}`);
    if (apply) {
      const created = await stripe.webhookEndpoints.create({ url: webhookUrl, enabled_events: events, description: `${prefix} production webhook`, metadata: tag });
      const path = join(ROOT, '.env.local');
      const raw = readFileSync(path, 'utf8');
      const line = `STRIPE_WEBHOOK_SECRET=${created.secret}`;
      const next = /^STRIPE_WEBHOOK_SECRET=.*$/m.test(raw) ? raw.replace(/^STRIPE_WEBHOOK_SECRET=.*$/m, line) : `${raw.trimEnd()}\n${line}\n`;
      writeFileSync(path, next);
      console.log(`    created ${created.id}; signing secret written to .env.local (not printed).`);
      console.log('    Copy it into CREDENTIALS.md (Rule 8) — this script does not write that file.');
    }
  }
}

if (!apply) console.log('Dry run — nothing changed. Re-run with --apply.');
