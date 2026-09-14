#!/usr/bin/env node
/**
 * Synthetic check of the LIVE deployment — what a user would actually get.
 *
 * WHY THIS EXISTS (DEF-058)
 *
 * The live site returned 200 for weeks while its backend did not exist. Every page rendered,
 * the uptime was technically perfect, and nobody could log in: the static export had baked in a
 * Supabase project that had been deleted. An uptime monitor that checks "does / return 200" is
 * green through that entire outage. This one checks what 200 was hiding:
 *
 *   1. the site answers, and serves HTML
 *   2. /healthz (liveness) and /readyz (readiness) answer — a missing /readyz means the build
 *      running in production predates the drain logic
 *   3. the security headers from vercel.json are actually present on the response
 *   4. the API is mounted (a GET on /api/analyze is a 405, never the SPA shell or a 404)
 *   5. the Supabase project baked into the SHIPPED JavaScript is the intended one
 *   6. that project exists and answers
 *
 * Usage:
 *   node scripts/check-production.mjs
 *   PRODUCTION_URL=https://example.com node scripts/check-production.mjs
 *
 * PRODUCTION_URL defaults to https://<hostname> from deploy/deploy.config.json.
 * NEXT_PUBLIC_SUPABASE_URL, when set, is the INTENDED backend; without it check 5 reports the
 * host it found and cannot say whether that host is the right one.
 *
 * Read-only: GET requests to public URLs. Prints no secret — the anon key is never sent.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

for (const line of safeRead(join(ROOT, '.env.local')).split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
}
function safeRead(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

const deployCfg = JSON.parse(readFileSync(join(ROOT, 'deploy/deploy.config.json'), 'utf8'));
const vercelCfg = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));

const BASE = (process.env.PRODUCTION_URL || `https://${deployCfg.hostname}`).replace(/\/+$/, '');
const INTENDED_SUPABASE = hostOf(process.env.NEXT_PUBLIC_SUPABASE_URL);
const TIMEOUT_MS = 10_000;
const RETRIES = 2;
// Enough to cover every chunk a Next.js export references from its landing page, bounded so a
// hostile or broken page cannot turn the check into a crawler.
const MAX_CHUNKS = 60;
const SUPABASE_HOST_RE = /https:\/\/([a-z0-9]{20})\.supabase\.co/g;

function hostOf(url) {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
}

async function get(url, { redirect = 'follow' } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const started = Date.now();
      const res = await fetch(url, { redirect, signal: controller.signal, headers: { 'User-Agent': 'equipcert-synthetic-check' } });
      const body = await res.text();
      return { status: res.status, headers: res.headers, body, ms: Date.now() - started };
    } catch (err) {
      lastError = err instanceof Error ? (err.cause?.code ?? err.message) : String(err);
      if (attempt < RETRIES) await delay(750 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  return { error: lastError };
}

const results = [];
const record = (name, ok, detail) => results.push({ name, state: ok === null ? 'skipped' : ok ? 'ok' : 'failed', detail });

// 1. The site.
const home = await get(`${BASE}/`);
if (home.error) {
  record('Site answers', false, home.error);
} else {
  const isHtml = (home.headers.get('content-type') || '').includes('text/html');
  record('Site answers', home.status === 200 && isHtml, `HTTP ${home.status} in ${home.ms} ms${isHtml ? '' : ', not HTML'}`);
}

// 2. Liveness and readiness.
for (const [name, path, expected] of [
  ['Liveness /healthz', '/healthz', 'ok'],
  ['Readiness /readyz', '/readyz', 'ready'],
]) {
  const r = await get(`${BASE}${path}`);
  if (r.error) record(name, false, r.error);
  else record(name, r.status === 200 && r.body.trim() === expected, `HTTP ${r.status}${r.status === 404 ? ' — deployed build predates this endpoint' : ''}`);
}

// 3. Security headers, derived from the same owner the deploy generator reads.
if (!home.error) {
  const expectedHeaders = vercelCfg.headers.find((h) => h.source === '/(.*)').headers;
  const missing = expectedHeaders.filter((h) => !home.headers.get(h.key));
  const drifted = expectedHeaders.filter((h) => home.headers.get(h.key) && home.headers.get(h.key) !== h.value);
  record(
    'Security headers',
    missing.length === 0 && drifted.length === 0,
    missing.length || drifted.length
      ? [missing.length && `missing ${missing.map((h) => h.key).join(', ')}`, drifted.length && `differs ${drifted.map((h) => h.key).join(', ')}`]
          .filter(Boolean)
          .join('; ')
      : `${expectedHeaders.length} present and identical to vercel.json`,
  );
}

// 4. The API is mounted.
const api = await get(`${BASE}/api/analyze`, { redirect: 'manual' });
if (api.error) record('API mounted', false, api.error);
else record('API mounted', api.status === 405, `GET /api/analyze -> HTTP ${api.status} (expected 405)`);

// 5 + 6. The backend baked into the shipped bundle.
if (home.error) {
  record('Bundled Supabase project', false, 'site unreachable, bundle not inspected');
} else {
  const chunkPaths = [...new Set([...home.body.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]))].slice(0, MAX_CHUNKS);
  const found = new Set();
  for (const path of chunkPaths) {
    const chunk = await get(`${BASE}${path}`);
    if (chunk.error || chunk.status !== 200) continue;
    for (const m of chunk.body.matchAll(SUPABASE_HOST_RE)) found.add(`${m[1]}.supabase.co`);
  }
  for (const m of home.body.matchAll(SUPABASE_HOST_RE)) found.add(`${m[1]}.supabase.co`);

  const hosts = [...found];
  if (hosts.length === 0) {
    record('Bundled Supabase project', false, `no Supabase host in ${chunkPaths.length} chunk(s)`);
  } else if (!INTENDED_SUPABASE) {
    record('Bundled Supabase project', null, `found ${hosts.join(', ')}; NEXT_PUBLIC_SUPABASE_URL unset, cannot compare`);
  } else {
    const wrong = hosts.filter((h) => h !== INTENDED_SUPABASE);
    record(
      'Bundled Supabase project',
      wrong.length === 0 && hosts.includes(INTENDED_SUPABASE),
      wrong.length ? `bundle targets ${wrong.join(', ')}, intended project is different` : 'matches the intended project',
    );
  }

  for (const host of hosts) {
    // No apikey is sent. 401 "no API key" still proves the project exists; a deleted project
    // does not resolve at all, which is exactly what DEF-058 looked like.
    const health = await get(`https://${host}/auth/v1/health`);
    if (health.error) record(`Backend ${host.slice(0, 6)}… exists`, false, `${health.error} — project deleted or paused?`);
    else record(`Backend ${host.slice(0, 6)}… exists`, [200, 401].includes(health.status), `HTTP ${health.status}`);
  }
}

const symbol = { ok: '✓', failed: '✗', skipped: '–' };
console.log(`Synthetic check: ${BASE}\n`);
for (const r of results) console.log(`${symbol[r.state]} ${r.name.padEnd(28)} ${r.detail}`);

const failed = results.filter((r) => r.state === 'failed');
if (failed.length) {
  console.error(`\n${failed.length} check(s) FAILED. A 200 on / is not the same as a working product (DEF-058).`);
  process.exit(1);
}
console.log('\nAll production checks passed.');
