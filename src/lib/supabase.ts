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
