// Central configuration — ALL env vars accessed through here. Zero hardcoding.
//
// Nothing outside this file may read process.env or invent a fallback default. Changing a
// provider URL, model, API version, limit, or timeout must be a config/env edit only.

/** Parse an integer env var, falling back to `fallback` when unset or malformed. */
function intEnv(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

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

  // Password safety. Supabase's own leaked-password protection is a Pro-plan feature, so the
  // same check runs against the same upstream corpus via the free k-anonymity range API.
  // `minLength` must stay in step with `minimum_password_length` in supabase/config.toml —
  // the database is the enforcer, this value only decides what the form says first.
  passwordSafety: {
    rangeUrl: process.env.NEXT_PUBLIC_PWNED_RANGE_URL || 'https://api.pwnedpasswords.com/range',
    minLength: intEnv(process.env.NEXT_PUBLIC_PASSWORD_MIN_LENGTH, 12),
    timeoutMs: intEnv(process.env.NEXT_PUBLIC_PWNED_TIMEOUT_MS, 4_000),
  },

  // Evidence storage. The bucket is private (see DEF-017), so every view needs a signed URL.
  // The TTL is a real trade-off: too short and a slow PDF render or a background tab produces
  // a broken image, too long and a leaked link stays useful. Ten minutes covers a page view
  // and a report download without outliving either.
  storage: {
    signedUrlTtlSeconds: intEnv(process.env.NEXT_PUBLIC_EVIDENCE_URL_TTL_SECONDS, 600),
  },

  // Photo capture — client-side downscale applied before upload. A phone camera frame is
  // 4–12 MB; shrinking here keeps requests inside ANALYZE_MAX_IMAGE_BYTES and cuts mobile
  // data use. Quality is a percentage because env vars parse as integers.
  capture: {
    maxEdgePx: intEnv(process.env.NEXT_PUBLIC_CAPTURE_MAX_EDGE_PX, 1600),
    jpegQualityPercent: intEnv(process.env.NEXT_PUBLIC_CAPTURE_JPEG_QUALITY, 85),
  },

  // Geolocation — reverse geocoding provider and capture timeout (client-side)
  geo: {
    reverseGeocodeUrl:
      process.env.NEXT_PUBLIC_REVERSE_GEOCODE_URL || 'https://nominatim.openstreetmap.org/reverse',
    gpsTimeoutMs: intEnv(process.env.NEXT_PUBLIC_GPS_TIMEOUT_MS, 10_000),
  },
} as const;

// Server-only config (Vercel serverless functions only — never import in client code)
export const serverConfig = {
  ai: {
    provider: (process.env.AI_PROVIDER || 'google') as 'google' | 'openai' | 'anthropic',
    model: process.env.AI_MODEL_NAME || 'gemini-2.5-flash',
    // GOOGLE_AI_API_KEY is a legacy name kept only as a fallback — see CREDENTIALS.md §15.
    apiKey: process.env.AI_API_KEY || process.env.GOOGLE_AI_API_KEY || '',
    maxTokens: intEnv(process.env.AI_MAX_TOKENS, 1024),
    // Anthropic REST details: this is the one authoritative definition.
    anthropic: {
      baseUrl: process.env.AI_ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1/messages',
      version: process.env.AI_ANTHROPIC_VERSION || '2023-06-01',
    },
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  },
  // Bypasses RLS — server-side handlers only, never a NEXT_PUBLIC_ var.
  supabase: {
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },
  // Operational limits for the /api/analyze endpoint
  analyze: {
    // Per authenticated user, per window. This is the budget that meters real usage.
    rateLimit: intEnv(process.env.ANALYZE_RATE_LIMIT, 20),
    // The pre-authentication guard is this multiple of the per-user limit, because one office
    // address legitimately carries many technicians. It exists to keep an unauthenticated
    // flood off the token-verification path, not to meter anything.
    ipBurstFactor: intEnv(process.env.ANALYZE_IP_BURST_FACTOR, 10),
    rateWindowMs: intEnv(process.env.ANALYZE_RATE_WINDOW_MS, 60 * 60 * 1000),
    maxImageBytes: intEnv(process.env.ANALYZE_MAX_IMAGE_BYTES, 10 * 1024 * 1024),
  },
  // ---------------------------------------------------------------------------------
  // Capacity tier.
  //
  // Every value below is a REAL limit of the plan named in SUPABASE_TIER, taken from the
  // provider's published limits rather than invented. Nothing here changes behaviour on its
  // own — these are the numbers the app uses to decide when to shed load, how long to cache,
  // and whether a feature that needs headroom may run at all.
  //
  // Set SUPABASE_TIER=pro and the app reads the Pro ceilings. That is the point: the upgrade
  // path is one environment variable, not a rewrite, and a reviewer can verify that claim by
  // flipping it rather than taking our word for it.
  //
  // Measured behaviour and the cost of each step are in docs/SCALING.md. Do not state a
  // capacity here that has not been measured — the ladder is honest or it is worthless.
  // ---------------------------------------------------------------------------------
  scale: {
    tier: (process.env.SUPABASE_TIER || 'free') as 'free' | 'pro' | 'team',

    // Pooler (Supavisor) connections. THIS is the binding constraint on concurrent writes,
    // not CPU and not bandwidth. free 200 / pro 500 / team 1000.
    poolerConnections: intEnv(process.env.SCALE_POOLER_CONNECTIONS, 200),

    // Direct Postgres connections. Far scarcer than pooler connections, which is exactly why
    // every client goes through the pooler. free 60.
    directConnections: intEnv(process.env.SCALE_DIRECT_CONNECTIONS, 60),

    // Realtime peak concurrent connections. free 200 / pro 500.
    // A dashboard left open on every technician's phone is a Realtime connection each, so
    // this ceiling arrives sooner than people expect.
    realtimePeakConnections: intEnv(process.env.SCALE_REALTIME_PEAK, 200),

    // Seconds the CDN may serve a static asset without revalidating. The static export is
    // immutable per build, so a long TTL is safe and is what keeps the origin idle: on the
    // free tier the marketing site and app shell should never reach it at all.
    edgeCacheSeconds: intEnv(process.env.SCALE_EDGE_CACHE_SECONDS, 31_536_000),

    // Seconds an HTML document may be cached. Short, because a deploy must be visible
    // quickly; the hashed assets it references carry the long TTL above.
    htmlCacheSeconds: intEnv(process.env.SCALE_HTML_CACHE_SECONDS, 60),
  },

  // Self-hosted runtime (deploy/server.ts). Unused on Vercel, which supplies its own
  // runtime and serves `out/` itself.
  selfHost: {
    port: intEnv(process.env.SELF_HOST_PORT, 8080),
    staticDir: process.env.SELF_HOST_STATIC_DIR || 'out',
    // Max bytes accepted for any single request body before the adapter rejects it.
    maxRequestBytes: intEnv(process.env.SELF_HOST_MAX_REQUEST_BYTES, 12 * 1024 * 1024),
  },
} as const;
