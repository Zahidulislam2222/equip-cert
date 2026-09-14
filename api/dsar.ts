import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { config, serverConfig } from '../src/lib/config';
import { limiterFor } from '../src/lib/server-rate-limit';
import { z } from 'zod';

/**
 * Data subject request intake — GDPR Arts. 15-22, and the US state right-to-know / delete /
 * opt-out equivalents.
 *
 * WHY THIS IS A SERVER ENDPOINT AND NOT A TABLE INSERT
 *
 * `data_subject_requests` has no INSERT policy, and that absence is deliberate. See
 * supabase/migrations/20260910001000_dsar_intake.sql for the argument in full; the short form
 * is that the people most likely to file an erasure request are precisely the people who no
 * longer have an account, so there is no JWT for a policy to test — and `organization_id` must
 * never be readable from a request body, or one tenant can file requests into another tenant's
 * privacy queue (OWASP API1).
 *
 * WHAT THIS ENDPOINT DOES NOT DO
 *
 * It does not act on the request. Art. 12(6) permits — and where there is doubt, requires —
 * the controller to verify the identity of the requester before disclosing or erasing anything.
 * An endpoint that erased an account because someone typed the address would be an
 * account-deletion API for strangers. What lands here is a row with a statutory clock on it and
 * a human obligation attached; verification and fulfilment happen in the admin queue.
 */

const limiter = limiterFor(serverConfig.dsar.rateWindowMs);

/**
 * Deliberately narrow. Every field is either supplied by the subject about themselves, or it is
 * derived server-side. There is no tenant id, no user id, no status, no deadline and no
 * `received_at` in this schema, because each of those is either the server's to decide or the
 * database's to compute.
 */
const dsarSchema = z.object({
  email: z.string().trim().toLowerCase().email('A valid email address is required').max(320),
  requestType: z.enum([
    'access',
    'rectification',
    'erasure',
    'portability',
    'restriction',
    'objection',
    'opt_out_sale',
  ]),
  // Drives the statutory deadline the database computes: one month under GDPR Art. 12(3),
  // 45 days under the US state laws. The subject asserts which regime they are invoking; where
  // both could apply the shorter clock is the safe one, so GDPR is the default.
  regime: z.enum(['gdpr', 'us_state']).default('gdpr'),
  message: z.string().trim().max(2000).optional(),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || 'unknown';
  if ((await limiter.hit(`dsar:${clientIp}`, serverConfig.dsar.rateLimit)).limited) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  const parsed = dsarSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request' });
  }
  const { email, requestType, regime, message } = parsed.data;

  const { url: supabaseUrl } = config.supabase;
  const { serviceRoleKey } = serverConfig.supabase;
  // Fail closed. A privacy endpoint that silently accepts a request it cannot store is worse
  // than one that is honestly unavailable: the subject believes a statutory clock is running.
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('DSAR intake not configured: Supabase URL or service role key missing.');
    return res.status(503).json({ error: 'Service unavailable' });
  }

  // Identity, when it exists, is taken from a verified token and never from the body.
  let subjectUserId: string | null = null;
  let organizationId: string | null = null;
  let source: 'web_form' | 'authenticated_app' = 'web_form';

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ') && config.supabase.anonKey) {
    const asUser = createClient(supabaseUrl, config.supabase.anonKey);
    const { data: authData } = await asUser.auth.getUser(authHeader.slice(7));
    if (authData?.user) {
      subjectUserId = authData.user.id;
      source = 'authenticated_app';
    }
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (subjectUserId) {
    // Read the tenant from the subject's own profile row. This is the only path by which
    // organization_id is ever set, which is what makes it impossible for a caller to aim a
    // request at a tenant they do not belong to.
    const { data: profile } = await admin
      .from('profiles')
      .select('organization_id')
      .eq('id', subjectUserId)
      .maybeSingle();
    organizationId = profile?.organization_id ?? null;
  }

  const { error } = await admin.from('data_subject_requests').insert({
    organization_id: organizationId,
    subject_user_id: subjectUserId,
    subject_email: email,
    request_type: requestType,
    regime,
    source,
    subject_message: message ?? null,
    // status defaults to 'received'; due_at is computed by the set_dsr_deadline trigger from
    // the regime. Neither is accepted from the caller, and received_at is the database's now().
  });

  if (error) {
    // 23505 is the partial unique index: an open request of this type already exists for this
    // address. Reported as success, because from the subject's point of view it IS success —
    // their request is on file and the clock is already running. Filing twice must not create
    // two deadlines, and must not tell an anonymous caller anything about existing rows.
    if (error.code === '23505') {
      return res.status(202).json({ received: true, duplicate: true });
    }
    console.error('DSAR intake failed:', error.code, error.message);
    return res.status(500).json({ error: 'Could not record the request. Please email us.' });
  }

  // 202, and a response that is identical whether or not the address has an account here.
  // Anything else turns a privacy form into an account-enumeration oracle: "we found your
  // data" and "we found nothing" are different answers, and only one of them is safe to give
  // to whoever typed the address.
  return res.status(202).json({ received: true, duplicate: false });
}
