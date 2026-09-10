/**
 * Fixed-window in-memory rate limiter.
 *
 * WHY THIS IS A MODULE AND NOT TEN LINES INSIDE THE HANDLER
 *
 * It used to be ten lines inside `api/analyze.ts`, and it had two defects that only a test
 * would have caught, because both are invisible when you read the happy path:
 *
 *   1. The map was unbounded. On Vercel that is hidden — a cold start discards the process. The
 *      identical code in `deploy/server.ts`, which is a long-lived Node process, keeps one
 *      permanent entry per distinct key forever. A client with an IPv6 /64 can drive that into
 *      memory exhaustion deliberately.
 *
 *   2. It keyed on IP alone. A fire-safety company behind one NAT gateway shared a single
 *      budget across every technician, while an attacker on mobile data got a fresh address on
 *      demand. It throttled the customer and not the attacker.
 *
 * A security control nobody can test is a security control nobody has verified. Extracting it
 * costs one file and buys `unit/rate-limit.test.mjs`.
 *
 * WHAT THIS IS NOT: distributed. Each process holds its own counters, so N instances behind a
 * load balancer permit up to N times the limit. That is acceptable here — the limit protects a
 * cost budget and a provider quota, not a correctness invariant — and the honest fix at scale
 * is a shared store, recorded in docs/SCALING.md rather than pretended away.
 */

export interface RateLimiterOptions {
  /** Window length in milliseconds. Counters reset wholesale at the end of a window. */
  windowMs: number;
  /**
   * Hard ceiling on tracked keys. Reached only under a key-flooding attack; a real deployment
   * sits far below it. See `hit` for why exceeding it denies rather than evicts.
   */
  maxKeys?: number;
}

export interface RateLimitResult {
  limited: boolean;
  /** Requests still allowed in the current window. Zero once limited. */
  remaining: number;
  /** Epoch ms at which this key's counter resets. */
  resetAt: number;
}

const DEFAULT_MAX_KEYS = 10_000;

export class RateLimiter {
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(options: RateLimiterOptions) {
    this.windowMs = options.windowMs;
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  }

  /** Number of keys currently tracked. Exposed so a test can prove eviction actually happens. */
  get size(): number {
    return this.buckets.size;
  }

  /** Drop every expired bucket. Called on demand rather than on a timer, so there is no
   *  interval keeping a serverless process alive after its response has been sent. */
  sweep(now: number = Date.now()): number {
    let removed = 0;
    for (const [key, bucket] of this.buckets) {
      if (now > bucket.resetAt) {
        this.buckets.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Record one request against `key` and report whether it exceeds `limit`.
   *
   * `limit` is a per-call argument rather than constructor state because one limiter instance
   * serves two populations with different budgets — an authenticated user and a raw address —
   * and two instances would mean two maps to bound and two to sweep.
   */
  hit(key: string, limit: number, now: number = Date.now()): RateLimitResult {
    const bucket = this.buckets.get(key);

    if (!bucket || now > bucket.resetAt) {
      if (!bucket && this.buckets.size >= this.maxKeys) {
        this.sweep(now);
        if (this.buckets.size >= this.maxKeys) {
          // Live traffic genuinely exceeds what we are willing to track. Deny.
          //
          // The tempting alternative is to evict the oldest key and admit the request. That
          // turns the ceiling into a bypass: flood distinct keys and every real user's counter
          // is evicted before it can ever reach its limit. A limiter that fails open under
          // load has switched itself off at precisely the moment it was needed.
          return { limited: true, remaining: 0, resetAt: now + this.windowMs };
        }
      }
      const resetAt = now + this.windowMs;
      this.buckets.set(key, { count: 1, resetAt });
      return { limited: limit < 1, remaining: Math.max(0, limit - 1), resetAt };
    }

    bucket.count++;
    const limited = bucket.count > limit;
    return {
      limited,
      remaining: limited ? 0 : Math.max(0, limit - bucket.count),
      resetAt: bucket.resetAt,
    };
  }

  /** Forget one key. Used by tests; also the seam for an administrative reset. */
  reset(key: string): void {
    this.buckets.delete(key);
  }
}
