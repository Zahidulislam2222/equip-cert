import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createAIProvider } from '../src/lib/ai/provider';
import { config, serverConfig } from '../src/lib/config';
import { z } from 'zod';

// Simple in-memory rate limiter (resets per cold start — good enough for serverless).
// Limits come from serverConfig.analyze — never redeclare them here.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + serverConfig.analyze.rateWindowMs });
    return false;
  }
  entry.count++;
  return entry.count > serverConfig.analyze.rateLimit;
}

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

  // Rate limiting
  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || 'unknown';
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }

  // Authentication — verify Supabase JWT
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { url: supabaseUrl, anonKey: supabaseAnonKey } = config.supabase;
  if (supabaseUrl && supabaseAnonKey) {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { error: authError } = await supabase.auth.getUser(authHeader.slice(7));
    if (authError) {
      return res.status(401).json({ error: 'Invalid token' });
    }
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

    return res.status(200).json(data);
  } catch (error) {
    console.error('AI Error:', error);
    return res.status(500).json({ error: 'Analysis failed. Please try again.' });
  }
}
