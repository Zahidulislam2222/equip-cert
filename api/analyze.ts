import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createAIProvider } from '../app/lib/ai/provider';
import type { AIProviderType } from '../app/lib/ai/types';
import { z } from 'zod';

// Simple in-memory rate limiter (resets per cold start — good enough for serverless)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 20; // requests per window
const RATE_WINDOW = 60 * 60 * 1000; // 1 hour

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

// Input validation schema
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const analyzeSchema = z.object({
  image: z.string().max(10 * 1024 * 1024, 'Image too large (max 10MB base64)'),
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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
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
    const provider = (process.env.AI_PROVIDER || 'google') as AIProviderType;
    const model = process.env.AI_MODEL_NAME || 'gemini-2.5-flash';
    const apiKey = process.env.AI_API_KEY || process.env.GOOGLE_AI_API_KEY || '';

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
