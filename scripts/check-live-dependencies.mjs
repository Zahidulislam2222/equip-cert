#!/usr/bin/env node
/**
 * Verify that the backends this app cannot run without are actually reachable.
 *
 * WHY THIS EXISTS (DEF-007)
 *
 * The Supabase project the app authenticated against was deleted, and every gate the project
 * had stayed green. Config boundary, ESLint, tsc and `next build` are all static: not one of
 * them makes a single outbound request. The site kept building, kept deploying and kept
 * rendering; only login was dead. `/api/analyze` even returned a plausible `401 Invalid
 * token`, because a failed `supabase.auth.getUser()` sets an auth error and the handler
 * cannot tell "bad token" from "backend does not exist". It failed closed, which is safe, and
 * silently, which is not.
 *
 * A build that ships against a backend which does not resolve should not be green.
 *
 * Usage:
 *   node scripts/check-live-dependencies.mjs
 *   node scripts/check-live-dependencies.mjs --warn-only   # report, do not fail
 *
 * Reads configuration from the environment, the same names src/lib/config.ts owns. Skips any
 * dependency whose variables are unset and says so, rather than inventing a URL.
 */

import { setTimeout as delay } from 'node:timers/promises';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Load .env.local the way `next build` would.
 *
 * A plain Node script gets none of Next.js's env loading, so without this the checks all
 * report "not configured" on a developer machine and the gate passes by doing nothing — the
 * exact silent-green failure it was written to prevent. In CI the values arrive as real
 * environment variables and the file is absent, so anything already set wins.
 */
function loadDotEnvLocal() {
  let raw;
  try {
    raw = readFileSync(join(ROOT, '.env.local'), 'utf8');
  } catch {
    return; // Fine in CI.
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue; // Real environment wins.
    process.env[key] = rawValue.trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}

loadDotEnvLocal();

const TIMEOUT_MS = 8_000;
const RETRIES = 2;
const warnOnly = process.argv.includes('--warn-only');

/**
 * One reachability probe.
 *
 * `expectStatus` is a predicate rather than a number because "reachable" is not the same as
 * "authorised": Supabase's auth health endpoint answers 200, while a Contentful space with a
 * valid token answers 200 and with a bad one answers 401 — both prove the service exists.
 * What we are testing here is that DNS resolves and something is listening.
 */
const checks = [
  {
    name: 'Supabase Auth',
    url: () => {
      const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
      return base ? `${base.replace(/\/$/, '')}/auth/v1/health` : null;
    },
    headers: () => ({ apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '' }),
    requires: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'],
    expectStatus: (s) => s === 200,
  },
  {
    name: 'Supabase REST',
    url: () => {
      const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
      return base ? `${base.replace(/\/$/, '')}/rest/v1/` : null;
    },
    headers: () => ({ apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '' }),
    requires: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'],
    // PostgREST answers 200 with the OpenAPI document; a project with everything revoked
    // from `anon` may answer 401. Either proves the project exists and is not paused.
    expectStatus: (s) => s === 200 || s === 401 || s === 404,
  },
  {
    name: 'Contentful CDA',
    url: () => {
      const space = process.env.NEXT_PUBLIC_CONTENTFUL_SPACE_ID;
      return space
        ? `https://cdn.contentful.com/spaces/${space}/environments/master/content_types?limit=1`
        : null;
    },
    headers: () => ({
      Authorization: `Bearer ${process.env.NEXT_PUBLIC_CONTENTFUL_ACCESS_TOKEN ?? ''}`,
    }),
    requires: ['NEXT_PUBLIC_CONTENTFUL_SPACE_ID', 'NEXT_PUBLIC_CONTENTFUL_ACCESS_TOKEN'],
    expectStatus: (s) => s === 200,
  },
];

/** Fetch with a hard timeout, retried on transport failure only. */
async function probe(check) {
  const url = check.url();
  const missing = check.requires.filter((name) => !process.env[name]);
  if (missing.length > 0 || !url) {
    return { state: 'skipped', detail: `not configured (${missing.join(', ')})` };
  }

  let lastError = 'unknown';
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const started = Date.now();
      const res = await fetch(url, {
        method: 'GET',
        headers: check.headers(),
        signal: controller.signal,
      });
      const ms = Date.now() - started;

      if (check.expectStatus(res.status)) {
        return { state: 'ok', detail: `HTTP ${res.status} in ${ms} ms` };
      }
      // A wrong-but-real status is a definitive answer; retrying will not change it.
      return { state: 'failed', detail: `HTTP ${res.status} in ${ms} ms` };
    } catch (error) {
      // DNS failure, connection refused, TLS error or timeout. This is the case that
      // matters: a deleted project resolves to nothing.
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < RETRIES) await delay(500 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  return { state: 'failed', detail: lastError };
}

const results = [];
for (const check of checks) {
  results.push({ name: check.name, ...(await probe(check)) });
}

const symbol = { ok: '✓', failed: '✗', skipped: '–' };
for (const r of results) {
  console.log(`${symbol[r.state]} ${r.name.padEnd(16)} ${r.detail}`);
}

const failed = results.filter((r) => r.state === 'failed');
const skipped = results.filter((r) => r.state === 'skipped');

if (failed.length === 0) {
  console.log(
    `\n${results.length - skipped.length} dependency check(s) passed` +
    (skipped.length ? `, ${skipped.length} skipped as unconfigured.` : '.')
  );
  process.exit(0);
}

console.error(`\n${failed.length} dependency check(s) FAILED: ${failed.map((f) => f.name).join(', ')}`);
console.error('The app cannot function against a backend that does not answer. This is DEF-007.');
process.exit(warnOnly ? 0 : 1);
