/**
 * Sole owner of the environment for the standalone operational scripts (`scripts/*.mjs`) and
 * the live e2e suites (`e2e/*.mjs`) — the Node-side counterpart of `src/lib/config.ts`.
 *
 * These files run under plain `node`, never through Next.js, so they cannot import the app's
 * TypeScript config module. Before this file existed each one carried its own `.env.local`
 * loader: six copies in three variants, two of which split on `\n` only and would silently
 * skip every line of a CRLF file (JS `.` does not match `\r`). `npm run test:config` now fails
 * if any script or e2e suite reads `process.env` anywhere but here.
 *
 * Zero dependencies, like every other script in this directory.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Supabase Management API. Used by the gates that read live project configuration. */
export const SUPABASE_MANAGEMENT_API = 'https://api.supabase.com';

/** Contentful Content Delivery API — the same default `mobile/lib/src/config/app_config.dart` owns. */
export const CONTENTFUL_CDA_URL = 'https://cdn.contentful.com';

const ENV_LINE = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/;
const PROJECT_REF = /^[a-z]{20}$/;
const LINK_FILE = join(ROOT, 'supabase', '.temp', 'project-ref');

/** Parse dotenv text into [name, value] pairs. CRLF-safe; strips one level of matching quotes. */
export function parseDotEnv(raw) {
  const pairs = [];
  for (const line of raw.split(/\r?\n/)) {
    const match = ENV_LINE.exec(line);
    if (match) pairs.push([match[1], match[2].trim().replace(/^(['"])(.*)\1$/, (_, _q, inner) => inner)]);
  }
  return pairs;
}

/**
 * Load `.env.local` the way `next build` would.
 *
 * Without this a developer's run reports "not configured" and a gate passes by doing nothing —
 * the silent-green failure these scripts exist to prevent. In CI the values arrive as real
 * environment variables and the file is absent, so anything already set wins, including an
 * explicitly empty value (which is how a caller forces a variable off).
 */
export function loadEnvLocal(path = join(ROOT, '.env.local'), target = process.env) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return; // Absent in CI.
    throw error; // Unreadable is not absent — say so instead of reporting every variable unset.
  }
  for (const [name, value] of parseDotEnv(raw)) {
    if (target[name] === undefined) target[name] = value;
  }
}

/** The real process environment, unmodified. For code that must not see `.env.local`. */
export function processEnv() {
  return process.env;
}

/** A variable's value, or `undefined` when it is unset or empty. */
export function env(name) {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

/** Print the two-line failure every gate uses, and exit 1. */
export function exitWith(message, detail) {
  console.error(`✗ ${message}`);
  if (detail) console.error(`  ${detail}`);
  process.exit(1);
}

/** A required variable, or exit 1 naming it. `why` says what cannot run without it. */
export function requireEnv(name, why) {
  return env(name) ?? exitWith(`${name} is not set.`, why);
}

/**
 * The Supabase project ref: `SUPABASE_PROJECT_REF`, else — when `fromLinkFile` — the one
 * `supabase link` wrote. Returns `null` when neither exists.
 *
 * Always validated: several callers interpolate it into a shell command (`npx` is a `.cmd` shim
 * on Windows, so `exec` goes through a shell) and the rest into a URL path, so the only value
 * that may reach either is provably a project ref and nothing else.
 */
export function supabaseProjectRef({ fromLinkFile = false, linkFile = LINK_FILE } = {}) {
  let ref = env('SUPABASE_PROJECT_REF');
  let source = 'SUPABASE_PROJECT_REF';
  if (!ref && fromLinkFile && existsSync(linkFile)) {
    ref = readFileSync(linkFile, 'utf8').trim();
    source = 'supabase/.temp/project-ref';
  }
  if (!ref) return null;
  if (!PROJECT_REF.test(ref)) exitWith(`${source} is not a valid project ref: ${ref}`);
  return ref;
}
