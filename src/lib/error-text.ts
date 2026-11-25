/**
 * A loggable description of anything thrown. Supabase/PostgREST errors are plain objects, not
 * `Error` instances, so `err instanceof Error ? err.message : 'unknown error'` logged every
 * database failure in the billing handlers as "unknown error" (E2E pass 2026-11-25). The code and
 * message are what an operator needs; no request data or secrets are included.
 */
export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; message?: unknown };
    const parts = [e.code, e.message].filter((p) => typeof p === 'string' && p.length > 0);
    if (parts.length) return parts.join(' ');
  }
  return 'unknown error';
}
