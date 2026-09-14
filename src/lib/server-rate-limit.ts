import { serverConfig } from './config';
import { createRateLimiter, type Limiter } from './rate-limit';

/**
 * A limiter wired to the configured store. Server handlers only.
 *
 * Kept apart from rate-limit.ts so that module never imports configuration: its unit tests bundle
 * it on its own and hand it every option explicitly, which is what lets them prove the fallback
 * behaviour without an environment.
 */

// Per process, per reason. During a store outage every request falls back; one line per request
// would bury every other log line exactly when an operator needs to read them.
const lastLogged = new Map<string, number>();

function warnThrottled(reason: string): void {
  const now = Date.now();
  const last = lastLogged.get(reason);
  if (last !== undefined && now - last < serverConfig.rateLimitStore.fallbackLogIntervalMs) return;
  lastLogged.set(reason, now);
  // The reason names the failure, never the key or the token.
  // Neutral prefix: the reason may be an outage OR a misconfiguration (unknown store, http URL),
  // and the operator should read which one rather than go looking for a Redis incident.
  console.warn(`[rate-limit] using the per-process limiter: ${reason}`);
}

export function limiterFor(windowMs: number): Limiter {
  const store = serverConfig.rateLimitStore;
  return createRateLimiter({
    windowMs,
    store: store.kind,
    shared: {
      url: store.url,
      token: store.token,
      timeoutMs: store.timeoutMs,
      keyPrefix: store.keyPrefix,
    },
    onFallback: warnThrottled,
  });
}
