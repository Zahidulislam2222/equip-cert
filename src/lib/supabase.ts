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
// UPGRADE PATH — read replicas (Supabase Pro + replica, ladder step 3 in docs/SCALING.md)
//
// THIS IS NOT ACTIVE. It is deliberately inert and left visible so the routing seam and its
// cost are legible without provisioning anything. No replica exists on the free tier, so
// there is no URL to point it at — the code cannot run, and pretending otherwise by wiring a
// fallback to the primary would silently make every "replica" read hit the primary and make
// the whole exercise a lie.
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
// WHAT TURNING IT ON WOULD TAKE:
//   1. Provision a read replica (Supabase Pro, from ~$0.02/hour).
//   2. Add SUPABASE_REPLICA_URL to src/lib/config.ts and .env.example.
//   3. Uncomment below and route read-only queries in the reporting and dashboard paths
//      through `supabaseRead` instead of `supabase`.
//
// WHAT WOULD NOT CHANGE, AND WHY THAT IS THE POINT: nothing about authorization. RLS is
// enforced by Postgres and replicated with the data, so a replica cannot be more permissive
// than the primary. Reads stay tenant-scoped without a single application-side check — which
// is precisely why the authorization boundary was put in the database rather than in
// middleware.
//
// export const supabaseRead = createClient<Database>(
//   config.supabase.replicaUrl,
//   config.supabase.anonKey,
//   { db: { schema: 'public' } },
// );
// ---------------------------------------------------------------------------------------
