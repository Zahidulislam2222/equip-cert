/**
 * Connection to the LOCAL Supabase stack (`npx supabase start`) for the local integration suite.
 *
 * WHY A LOCAL STACK
 *
 * `npm run test:rls` runs against the live project and leaves a signed fixture behind on every run,
 * by design (DEF-072). The tests in this folder create and destroy tenants, invitations and
 * billing state freely, so they must never touch the live project. The local stack is the real
 * engine (Postgres, PostgREST, GoTrue) with every migration in `supabase/migrations/` applied from
 * scratch — which also proves the migrations still build a clean database (Rule 23).
 *
 * The URL and keys come from `supabase status`, not from the environment: they are the CLI's fixed,
 * public local-development values, and reading them this way means the suite can never be pointed
 * at a remote project by a stray variable.
 */

import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { ROOT } from '../../scripts/lib/ops-env.mjs';

function readStatus() {
  let raw;
  try {
    // One string through the shell: Node 24 refuses to execFile a .cmd shim on Windows.
    raw = execSync('npx --silent supabase status -o json', {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new Error(
      'The local Supabase stack is not running. Start it with `npx supabase start` ' +
        `(needs Docker). ${error instanceof Error ? error.message.split('\n')[0] : ''}`
    );
  }
  const json = JSON.parse(raw.slice(raw.indexOf('{')));
  const url = json.API_URL;
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url ?? '')) {
    throw new Error(`Refusing to run: API_URL ${url} is not a local stack.`);
  }
  return { url, anonKey: json.ANON_KEY, serviceKey: json.SERVICE_ROLE_KEY, dbUrl: json.DB_URL };
}

export const stack = readStatus();

/** Bypasses RLS. Fixture setup/teardown and post-condition reads only — never the actor. */
export const admin = createClient(stack.url, stack.serviceKey, { auth: { persistSession: false } });

export const RUN = Math.random().toString(36).slice(2, 10);
export const PASSWORD = `Local-${RUN}-${Math.random().toString(36).slice(2)}`;

/** A confirmed auth user with the given metadata, and a client signed in as them. */
export async function userWithSession(label, metadata = {}) {
  const email = `local-${label}-${RUN}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: metadata,
  });
  if (error) throw new Error(`Fixture user ${label}: ${error.message}`);
  const client = createClient(stack.url, stack.anonKey, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw new Error(`Sign-in ${label}: ${signInError.message}`);
  return { id: data.user.id, email, client };
}

/** A fresh anonymous client (no session). */
export function anonClient() {
  return createClient(stack.url, stack.anonKey, { auth: { persistSession: false } });
}
