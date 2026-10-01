#!/usr/bin/env node
/**
 * Keep the Supabase free project awake with REAL database activity.
 *
 * WHY THIS EXISTS (DEF-069)
 *
 * Supabase pauses a Free project that "does not receive sufficient user database activity over
 * the past week" (supabase.com/docs/guides/platform/free-project-pausing), and a paused project
 * loses its DNS record. The previous keepalive pinged GET /auth/v1/health twice a week. GoTrue
 * answers that endpoint without touching Postgres, so the ping reported green on 2026-09-14 and
 * 2026-09-17 while the project was being counted as idle — and by 2026-09-21 the host no longer
 * resolved. A keepalive that cannot fail for the reason it exists is not a keepalive.
 *
 * This one asks PostgREST for one row of `plan_limits`. PostgREST can only answer that by running
 * a SELECT in the project's Postgres, and success is judged on the body, not the status code: a
 * non-empty JSON array whose rows carry `plan_id` is something only that query can produce.
 *
 * WHY THE SERVICE-ROLE KEY
 *
 * `anon` has no privileges on any table, deliberately (20260910000200_rls_policies.sql), and a
 * keepalive is not a reason to grant it one. The read is a GET of one column of one row of
 * seeded reference data that holds no personal data. The workflow that calls this runs only on
 * `schedule` / `workflow_dispatch`, never on pull requests, so no fork can reach the secret.
 * Because the key rides in a header, the base URL must be https (loopback excepted, for the
 * local stack) and redirects are refused: `fetch` strips `Authorization` on a cross-origin
 * redirect but forwards `apikey`, which carries the same key.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/supabase-keepalive.mjs
 *
 * Exit 0 only after a verified row, and only then prints the line the workflow asserts on.
 * Prints the reference row, never the key.
 */

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { processEnv } from './lib/ops-env.mjs';

// The query is the contract with the schema, not a tunable: one seeded reference table.
export const KEEPALIVE_PATH = '/rest/v1/plan_limits?select=plan_id&limit=1';
// The workflow greps for this exact prefix, so a run that never reached this line cannot pass.
export const SUCCESS_PREFIX = 'Database answered:';
// Same budget the previous curl step used (--max-time 20).
const REQUEST_TIMEOUT_MS = 20_000;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Validate the base URL before any request carries the key.
 * @returns {{ ok: true, base: string, host: string } | { ok: false, reason: string }}
 */
export function parseBaseUrl(raw) {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'NEXT_PUBLIC_SUPABASE_URL is not an absolute URL (missing https://?)' };
  }
  if (url.username || url.password) {
    // fetch echoes the full URL in its errors, so embedded credentials would reach the log.
    return { ok: false, reason: 'NEXT_PUBLIC_SUPABASE_URL must not embed a username or password' };
  }
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) {
    return {
      ok: false,
      reason: `NEXT_PUBLIC_SUPABASE_URL must be https (got ${url.protocol}) — the key would travel in cleartext`,
    };
  }
  return { ok: true, base: trimmed, host: url.host };
}

/**
 * Decide whether a PostgREST response proves Postgres ran the query.
 * @returns {{ ok: true, row: object } | { ok: false, reason: string }}
 */
export function verifyKeepaliveResponse(status, bodyText) {
  if (status !== 200) {
    return { ok: false, reason: `expected HTTP 200 from PostgREST, got ${status}` };
  }
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return { ok: false, reason: 'HTTP 200 but the body is not JSON — the URL is not PostgREST' };
  }
  if (!Array.isArray(body)) {
    return { ok: false, reason: 'HTTP 200 but the body is not a JSON array — not a table read' };
  }
  if (body.length === 0) {
    return {
      ok: false,
      reason: 'plan_limits returned no rows — the seed migration is missing or the key cannot read it',
    };
  }
  const row = body[0];
  if (row === null || typeof row !== 'object' || typeof row.plan_id !== 'string') {
    return { ok: false, reason: 'the row has no plan_id — the response is not from plan_limits' };
  }
  return { ok: true, row };
}

/** Name a network failure precisely; only ENOTFOUND means the DNS record is gone. */
export function describeNetworkError(error) {
  const code = error?.cause?.code ?? error?.code;
  if (code === 'ENOTFOUND') {
    return 'ENOTFOUND — the DNS record is gone, i.e. the project is paused or deleted. Restore it from the Supabase dashboard.';
  }
  if (error?.name === 'TimeoutError') return `no answer within ${REQUEST_TIMEOUT_MS} ms`;
  const detail = code ?? error?.cause?.message ?? error?.message ?? 'request failed';
  const redirected = /redirect/i.test(`${error?.cause?.message ?? ''} ${error?.message ?? ''}`);
  return redirected ? `${detail} (a redirect is refused on purpose — the key must not follow it)` : detail;
}

function fail(title, message) {
  // GitHub Actions renders this as an annotation; locally it is just a readable line.
  console.log(`::error title=${title}::${message}`);
  process.exitCode = 1;
}

export async function main(env = processEnv()) {
  const key = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!(env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim() || !key) {
    fail(
      'Keepalive is inert',
      'NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set. This job would query ' +
        'nothing and report success, which is exactly what let DEF-007 and DEF-069 go unnoticed.',
    );
    return;
  }
  const target = parseBaseUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!target.ok) {
    fail('Keepalive is misconfigured', target.reason);
    return;
  }

  let status;
  let bodyText;
  try {
    const response = await fetch(`${target.base}${KEEPALIVE_PATH}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    status = response.status;
    bodyText = await response.text();
  } catch (error) {
    fail('Supabase is unreachable', `${target.host}: ${describeNetworkError(error)}`);
    return;
  }

  const result = verifyKeepaliveResponse(status, bodyText);
  if (!result.ok) {
    fail('Keepalive did not reach the database', result.reason);
    return;
  }
  console.log(`${SUCCESS_PREFIX} plan_limits row plan_id=${result.row.plan_id}. Project is active.`);
}

// Compare real paths: Node resolves symlinks/junctions in import.meta.url but not in argv[1],
// and a guard that silently skips main() exits 0 — the one outcome this script must never fake.
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  await main();
}
