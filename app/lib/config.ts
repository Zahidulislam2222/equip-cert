// Central configuration — ALL env vars accessed through here. Zero hardcoding.

export const config = {
  // App
  app: {
    name: process.env.NEXT_PUBLIC_APP_NAME || 'EquipCert AI',
    url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  },

  // Supabase
  supabase: {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  },

  // Contentful
  contentful: {
    spaceId: process.env.NEXT_PUBLIC_CONTENTFUL_SPACE_ID!,
    accessToken: process.env.NEXT_PUBLIC_CONTENTFUL_ACCESS_TOKEN!,
  },

  // Stripe (client-side key only — secret key stays in Vercel functions)
  stripe: {
    publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '',
  },
} as const;

// Server-only config (Vercel serverless functions only — never import in client code)
export const serverConfig = {
  ai: {
    provider: (process.env.AI_PROVIDER || 'google') as 'google' | 'openai' | 'anthropic',
    model: process.env.AI_MODEL_NAME || 'gemini-2.5-flash',
    apiKey: process.env.AI_API_KEY || process.env.GOOGLE_AI_API_KEY || '',
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  },
} as const;
