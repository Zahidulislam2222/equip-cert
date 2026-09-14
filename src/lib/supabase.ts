import { createClient } from '@supabase/supabase-js';
import { config } from './config';
import type { Database } from './database.types';

/**
 * The browser Supabase client, typed against the actual schema.
 *
 * The type parameter is not decoration. Without it every table name and every column name in
 * the application is an unchecked string, and the schema and the code drift apart silently —
 * which is exactly how DEF-023 survived: the corrective-action form inserted a `photo_url`
 * column that no schema has ever had, and nothing in the build could compare the two. With
 * `Database` in place that line is a compile error.
 *
 * `src/lib/database.types.ts` is GENERATED. Regenerate it whenever a migration changes the
 * schema:
 *
 *     npm run gen:types
 *
 * `npm run test:types` fails the build when it has drifted, so the generated file cannot
 * quietly fall behind the migrations the way the SQL plan limit fell behind plans.ts.
 */
export const supabase = createClient<Database>(config.supabase.url, config.supabase.anonKey);

// ---------------------------------------------------------------------------------------
// READ REPLICA ROUTING (Supabase Pro + replica, ladder step 3 in docs/SCALING.md)
//
// Real and config-gated. Set NEXT_PUBLIC_SUPABASE_READ_REPLICA_URL to a replica's Data API
// endpoint and `supabaseRead` sends its queries there; leave it empty (the free-tier default)
// and `supabaseRead` is the primary client itself. The fallback is not hidden: callers and
// reviewers can read `readReplicaEnabled`, so a "replica" read that is really hitting the
// primary is a visible, deliberate state rather than a silent one.
//
// WHY THE ACCESS TOKEN IS BRIDGED. Supabase serves Auth only from the primary — a replica
// endpoint cannot sign anyone in (Supabase read-replica docs). The replica client therefore
// owns no session: `accessToken` hands it the primary client's current user JWT on every
// request, so PostgREST on the replica evaluates the SAME auth.uid() and the same RLS
// policies. With no session the library sends the anon key (supabase-js 2.102
// fetchWithAuth), which RLS treats as anonymous — never as elevated.
//
// Not verified against a real replica: none is provisioned (paid). What IS verified is the
// library contract above and that the fallback path is the primary client.
//
// WHY IT IS THE RIGHT NEXT STEP. The measured static ceiling is a CPU-bound Node process,
// which is cheap to multiply (ladder step 1, $0). The ceiling that actually costs money is
// the 200 pooler connections in front of Postgres. Reporting and dashboard queries are the
// heaviest reads in this application and none of them need the primary: they tolerate replica
// lag of a second or two, because an inspection filed moments ago appearing in a monthly
// report a beat later changes nothing. Moving them off the primary reserves its connection
// budget for the writes that must not queue — inspection submissions from technicians in the
// field.
//
// WHAT TURNING IT ON TAKES: provision a replica (Supabase Pro, paid — see SCALING.md), set the
// env var, rebuild. No code change.
//
// WHAT MAY USE IT: only reads that tolerate replication lag (asynchronous; seconds). The
// monthly dashboard aggregate does. Lists a user just wrote to do NOT — they stay on
// `supabase`, or a technician would file an inspection and not see it.
//
// WHAT DOES NOT CHANGE: authorization. The replica is a physical copy of the same database,
// policies included, so it cannot be more permissive than the primary.
// ---------------------------------------------------------------------------------------

export const readReplicaEnabled = config.supabase.readReplicaUrl !== '';

export const supabaseRead = readReplicaEnabled
  ? createClient<Database>(config.supabase.readReplicaUrl, config.supabase.anonKey, {
      accessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
    })
  : supabase;
