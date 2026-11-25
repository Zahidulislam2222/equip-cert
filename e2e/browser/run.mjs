#!/usr/bin/env node
/**
 * Browser-flow suite runner (web client) — `npm run test:browser`.
 *
 * Builds the static export pointed at the LOCAL Supabase stack, bundles the self-host adapter,
 * starts it on a loopback port, runs Playwright, and stops the server. Nothing here can reach the
 * live project: the URL and keys come from `supabase status` via e2e/local/stack.mjs, which
 * refuses a non-local API URL.
 *
 * External services are deliberately left unconfigured so every flow is deterministic and free:
 * no OpenRouter key (the assistant answers from its help-article fallback), no Stripe key (billing
 * reports "not configured"). Their live behaviour is covered by scripts/eval-assistant.mjs and the
 * Stripe unit tests.
 *
 * NOTE: this overwrites `out/` with a LOCAL build. Rebuild before any deployment.
 */
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, processEnv } from '../../scripts/lib/ops-env.mjs';
import { stack } from '../local/stack.mjs';
import { BROWSER_PORT, BASE_URL } from './settings.mjs';

const env = {
  ...processEnv(),
  NEXT_PUBLIC_SUPABASE_URL: stack.url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: stack.anonKey,
  NEXT_PUBLIC_APP_URL: BASE_URL,
  NEXT_PUBLIC_CONSENT_BANNER_DELAY_MS: '1',
  SUPABASE_SERVICE_ROLE_KEY: stack.serviceKey,
  SELF_HOST_PORT: String(BROWSER_PORT),
  OPENROUTER_API_KEY: '',
  STRIPE_SECRET_KEY: '',
  STRIPE_WEBHOOK_SECRET: '',
  RATE_LIMIT_REDIS_URL: '',
  RATE_LIMIT_REDIS_TOKEN: '',
};

function run(cmd) {
  console.log(`\n$ ${cmd}`);
  const r = spawnSync(cmd, { cwd: ROOT, env, stdio: 'inherit', shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!process.argv.includes('--no-build')) {
  run('npx next build');
  run('npm run build:server --silent');
}

const server = spawn(process.execPath, ['deploy/generated/server.cjs'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${BASE_URL}/`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`The local server did not start on ${BASE_URL}.\n${serverLog}`);
}

let code = 1;
try {
  await waitForServer();
  const args = process.argv.slice(2).filter((a) => a !== '--no-build');
  const r = spawnSync(`npx playwright test --config e2e/browser/playwright.config.mjs ${args.join(' ')}`, {
    cwd: ROOT,
    env,
    stdio: 'inherit',
    shell: true,
  });
  code = r.status ?? 1;
} finally {
  server.kill();
  if (code !== 0) console.log(`\n--- server log (tail) ---\n${serverLog.split('\n').slice(-40).join('\n')}`);
}
process.exit(code);
