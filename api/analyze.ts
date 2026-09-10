import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createAIProvider } from '../src/lib/ai/provider';
import { config, serverConfig } from '../src/lib/config';
import { RateLimiter } from '../src/lib/rate-limit';
import { z } from 'zod';

/**
 * One limiter, two populations.
 *
 * `ip:` buckets are checked BEFORE authentication, where the address is the only identifier
 * that exists, and exist only to keep an unauthenticated flood off the token-verification
 * round trip. `user:` buckets are the real meter and are checked after the token is verified,
 * because the account is what actually spends the AI budget — see src/lib/rate-limit.ts for
 * why keying on the address alone throttled the customer and not the attacker.
 *
 * Limits come from serverConfig.analyze — never redeclare them here.
 */
const limiter = new RateLimiter({ windowMs: serverConfig.analyze.rateWindowMs });

// Input validation schema
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const analyzeSchema = z.object({
  image: z
    .string()
    .max(serverConfig.analyze.maxImageBytes, 'Image too large'),
  mimeType: z.enum(ALLOWED_MIME_TYPES, {
    message: 'Invalid image type. Allowed: jpeg, png, webp',
  }),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Pre-auth flood guard. Only the address exists at this point, so it is the only thing we
  // can key on. Deliberately looser than the per-user limit below: its job is to keep an
  // unauthenticated flood away from the token-verification round trip, not to meter usage.
  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || 'unknown';
  const ipBudget = serverConfig.analyze.rateLimit * serverConfig.analyze.ipBurstFactor;
  if (limiter.hit(`ip:${clientIp}`, ipBudget).limited) {
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }

  // Authentication — verify Supabase JWT
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // FAIL CLOSED. The previous version wrapped this whole block in
  // `if (supabaseUrl && supabaseAnonKey)`, so a project deployed with either variable missing
  // skipped verification entirely and served a third-party AI provider to anyone who sent the
  // word "Bearer". A misconfiguration must never silently become an authorization bypass —
  // that is OWASP API2 with the configuration boundary as the trigger.
  const { url: supabaseUrl, anonKey: supabaseAnonKey } = config.supabase;
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Auth not configured: NEXT_PUBLIC_SUPABASE_URL / ANON_KEY missing.');
    return res.status(503).json({ error: 'Service unavailable' });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data: authData, error: authError } = await supabase.auth.getUser(authHeader.slice(7));
  if (authError || !authData?.user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // The real meter: the account spending the AI budget, not the gateway it happens to sit
  // behind. An office of ten technicians on one NAT gets ten budgets, and an attacker who
  // rotates addresses still gets one.
  if (limiter.hit(`user:${authData.user.id}`, serverConfig.analyze.rateLimit).limited) {
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }

  // Input validation
  const parsed = analyzeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input' });
  }

  const { image, mimeType } = parsed.data;

  try {
    const { provider, model, apiKey } = serverConfig.ai;

    if (!apiKey) {
      return res.status(500).json({ error: 'AI service not configured' });
    }

    const ai = createAIProvider(provider, model, apiKey);
    const data = await ai.analyzeImage(image, mimeType);

    // EU AI Act Art. 50(1) — the caller must be able to disclose that this result is
    // machine-generated, and the inspection record must carry which system generated it.
    // Provenance is stamped HERE because only the server knows which provider and model ran;
    // a client-asserted value would be traceability theatre. `disclosedAt` is server-generated
    // for the same reason every other compliance timestamp in this schema is.
    return res.status(200).json({
      ...data,
      provenance: {
        aiAssisted: true,
        provider,
        model,
        disclosedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('AI Error:', error);
    return res.status(500).json({ error: 'Analysis failed. Please try again.' });
  }
}
