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
 * DISTRIBUTED, WHEN CONFIGURED. `RateLimiter` holds its counters in one process, so N replicas
 * behind a load balancer permit up to N times the limit. `createRateLimiter` returns the same
 * contract backed by a shared Redis store over its REST interface when `RATE_LIMIT_STORE` says
 * so — every replica, every region and every serverless instance then spends one budget. See
 * docs/SCALING.md for when that matters.
 *
 * The shared store can be down. When it is, each process falls back to its OWN in-memory
 * limiter rather than admitting everything: a degraded limiter that permits N times the limit
 * is a capacity problem, a limiter that fails open is no limiter at all.
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

// ---------------------------------------------------------------------------------------------
// Pluggable store.
// ---------------------------------------------------------------------------------------------

/** What a handler holds. Asynchronous because a shared store is a network round trip. */
export interface Limiter {
  hit(key: string, limit: number): Promise<RateLimitResult>;
}

/**
 * The minimal fetch shape the Redis store needs. Injected so a unit test can hand it a fake
 * transport — including one that hangs or throws — without a network or a mocking library.
 */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface SharedStoreOptions {
  /** REST endpoint of a Redis-compatible store (Upstash-style `/pipeline`). */
  url: string;
  token: string;
  /** Round-trip budget. Past it the request is decided locally rather than kept waiting. */
  timeoutMs: number;
  /** Namespaces the keys so two deployments sharing one store do not share budgets. */
  keyPrefix: string;
}

export interface CreateLimiterOptions extends RateLimiterOptions {
  /** 'memory' or 'redis-rest'. Typed as the raw configured string so an unknown value is reported. */
  store: string;
  shared?: SharedStoreOptions;
  fetch?: FetchLike;
  /**
   * Called on EVERY request that falls back (and once at construction for a misconfiguration), so
   * the degradation is never silent. The caller owns throttling — see server-rate-limit.ts.
   */
  onFallback?: (reason: string) => void;
}

/** Wrap the synchronous in-memory limiter in the async contract. */
class MemoryLimiter implements Limiter {
  constructor(private readonly inner: RateLimiter) {}
  async hit(key: string, limit: number): Promise<RateLimitResult> {
    return this.inner.hit(key, limit);
  }
}

/**
 * The shared store key is a hash, not the raw key.
 *
 * Keys carry IP addresses and account ids, which are personal data (GDPR Recital 30). Sending
 * them to a third-party store in the clear would make that store a processor of addresses it has
 * no need to read. A SHA-256 of the key counts exactly as well.
 *
 * Be precise about what that buys: it is pseudonymisation, not anonymisation. The IPv4 space is
 * small enough to enumerate, so a store operator determined to reverse a hash could. It keeps
 * addresses out of the store's dashboards, logs and backups, which is data minimisation — it is
 * not a claim that the hash is not personal data. Web Crypto rather than node:crypto, so the same
 * code runs on Vercel, in the Node adapter and at the edge.
 */
async function hashKey(prefix: string, key: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}:${hex}`;
}

class RedisRestLimiter implements Limiter {
  constructor(
    private readonly windowMs: number,
    private readonly shared: SharedStoreOptions,
    private readonly fetchImpl: FetchLike,
    private readonly fallback: RateLimiter,
    private readonly onFallback: (reason: string) => void,
  ) {}

  async hit(key: string, limit: number): Promise<RateLimitResult> {
    const now = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.shared.timeoutMs);
    try {
      const k = await hashKey(this.shared.keyPrefix, key);
      // Fixed window, atomic per key: create the counter with its expiry only if absent, then
      // increment and read the remaining TTL. SET NX PX + INCR works on every Redis since 2.6.12,
      // unlike EXPIRE NX, and a pipeline is one round trip.
      const res = await this.fetchImpl(`${this.shared.url.replace(/\/+$/, '')}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.shared.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([
          ['SET', k, '0', 'PX', String(this.windowMs), 'NX'],
          ['INCR', k],
          ['PTTL', k],
        ]),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`store responded ${res.status}`);

      const body = (await res.json()) as Array<{ result?: unknown; error?: string }>;
      const count = Number(body?.[1]?.result);
      const ttl = Number(body?.[2]?.result);
      if (!Array.isArray(body) || body.some((r) => r?.error) || !Number.isFinite(count)) {
        throw new Error('store returned an unexpected shape');
      }

      // The pipeline is one round trip, NOT a transaction. If the key expires between SET NX
      // (skipped: key still existed) and INCR, INCR recreates it with NO expiry and the counter
      // would grow forever — a permanent 429 for that user or address. PTTL -1 is that state;
      // repair it by giving the key a window. Rare, so the second round trip costs nothing.
      if (ttl === -1) {
        const repair = await this.fetchImpl(`${this.shared.url.replace(/\/+$/, '')}/pipeline`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.shared.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify([['PEXPIRE', k, String(this.windowMs)]]),
          signal: controller.signal,
        });
        if (!repair.ok) throw new Error(`store responded ${repair.status} while repairing a key without expiry`);
        // Same shape rule as the main pipeline: a 200 can still carry a per-command error (a token
        // not permitted PEXPIRE, say). Accepting it would leave the key unexpired and silent.
        const repaired = (await repair.json()) as Array<{ result?: unknown; error?: string }>;
        if (!Array.isArray(repaired) || repaired.some((r) => r?.error)) {
          throw new Error('store refused to set an expiry on a counter without one');
        }
      }

      const resetAt = now + (Number.isFinite(ttl) && ttl > 0 ? ttl : this.windowMs);
      const limited = count > limit;
      return { limited, remaining: limited ? 0 : Math.max(0, limit - count), resetAt };
    } catch (err) {
      // Never fail open. The process-local limiter still enforces the limit per replica.
      this.onFallback(err instanceof Error ? err.message : String(err));
      return this.fallback.hit(key, limit, now);
    } finally {
      clearTimeout(timer);
    }
  }
}

function isSafeStoreUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

/**
 * The only constructor handlers should call. Selecting the store is a configuration decision
 * (`serverConfig.rateLimitStore`); a handler never knows or cares which one it got.
 *
 * A shared store selected without a URL or token is a misconfiguration, and it degrades to the
 * in-memory limiter with a logged reason rather than throwing at import time and taking the
 * endpoint down with it.
 */
export function createRateLimiter(options: CreateLimiterOptions): Limiter {
  const local = new RateLimiter(options);
  const report = options.onFallback ?? (() => {});

  if (options.store !== 'redis-rest') {
    // A typo ("redis", "Redis-REST") must not silently become per-process limiting.
    if (options.store !== 'memory') report(`unknown RATE_LIMIT_STORE "${options.store}"; using memory`);
    return new MemoryLimiter(local);
  }
  const shared = options.shared;
  const fetchImpl = options.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!shared?.url || !shared.token || !fetchImpl) {
    report('redis-rest selected but RATE_LIMIT_REDIS_URL / RATE_LIMIT_REDIS_TOKEN are not set');
    return new MemoryLimiter(local);
  }
  // The token travels as a bearer header: plain HTTP is only acceptable to this machine.
  if (!isSafeStoreUrl(shared.url)) {
    report('RATE_LIMIT_REDIS_URL must be https:// (plain http is allowed only for localhost); using memory');
    return new MemoryLimiter(local);
  }
  return new RedisRestLimiter(options.windowMs, shared, fetchImpl, local, report);
}
