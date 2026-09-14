// Unit tests for the rate limiter.
//
// This exists because the previous implementation — ten lines inside api/analyze.ts — shipped
// with two defects that a reader nods past and a test catches immediately: an unbounded map,
// and a key that throttled the customer instead of the attacker. Both are now asserted.
//
// Time is injected rather than mocked globally. A limiter test that sleeps is a slow test that
// still cannot prove what happens at the window boundary.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let RateLimiter;
let createRateLimiter;
let workDir;

before(() => {
  workDir = mkdtempSync(join(tmpdir(), 'equipcert-unit-'));
  const outFile = join(workDir, 'rate-limit.mjs');
  execFileSync(
    process.execPath,
    [
      join('node_modules', 'esbuild', 'bin', 'esbuild'),
      'src/lib/rate-limit.ts',
      '--bundle',
      '--format=esm',
      '--platform=neutral',
      '--log-level=warning',
      `--outfile=${outFile}`,
    ],
    { stdio: 'inherit' },
  );
  return import(pathToFileURL(outFile).href).then((m) => {
    RateLimiter = m.RateLimiter;
    createRateLimiter = m.createRateLimiter;
  });
});

after(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

const T0 = 1_000_000;

describe('counting within a window', () => {
  test('permits exactly `limit` requests and denies the next one', () => {
    const rl = new RateLimiter({ windowMs: 60_000 });
    for (let i = 1; i <= 3; i++) {
      assert.equal(rl.hit('k', 3, T0).limited, false, `request ${i} should pass`);
    }
    assert.equal(rl.hit('k', 3, T0).limited, true, 'the 4th request must be denied');
  });

  test('remaining counts down to zero and does not go negative', () => {
    const rl = new RateLimiter({ windowMs: 60_000 });
    assert.equal(rl.hit('k', 2, T0).remaining, 1);
    assert.equal(rl.hit('k', 2, T0).remaining, 0);
    assert.equal(rl.hit('k', 2, T0).remaining, 0);
  });

  test('a limit of zero denies the very first request', () => {
    // Not hypothetical: a misread env var yielding 0 must lock the endpoint, not open it.
    const rl = new RateLimiter({ windowMs: 60_000 });
    assert.equal(rl.hit('k', 0, T0).limited, true);
  });
});

describe('keys are independent', () => {
  test('exhausting one key does not affect another', () => {
    const rl = new RateLimiter({ windowMs: 60_000 });
    rl.hit('user:a', 1, T0);
    assert.equal(rl.hit('user:a', 1, T0).limited, true);

    // The whole point of keying on the account: one technician burning their budget must not
    // lock out a colleague who happens to sit behind the same office gateway.
    assert.equal(rl.hit('user:b', 1, T0).limited, false);
  });

  test('the pre-auth address bucket and the per-user bucket do not share a counter', () => {
    const rl = new RateLimiter({ windowMs: 60_000 });
    rl.hit('ip:203.0.113.7', 1, T0);
    assert.equal(rl.hit('ip:203.0.113.7', 1, T0).limited, true);
    assert.equal(rl.hit('user:203.0.113.7', 1, T0).limited, false);
  });
});

describe('the window actually resets', () => {
  test('a request after resetAt starts a fresh window', () => {
    const rl = new RateLimiter({ windowMs: 60_000 });
    const first = rl.hit('k', 1, T0);
    assert.equal(rl.hit('k', 1, T0).limited, true);

    // Exactly at resetAt is still inside the window; the check is `now > resetAt`.
    assert.equal(rl.hit('k', 1, first.resetAt).limited, true, 'boundary must not open early');
    assert.equal(rl.hit('k', 1, first.resetAt + 1).limited, false, 'one ms later it must reset');
  });
});

describe('memory is bounded — the defect that Vercel hid', () => {
  test('expired keys are swept rather than accumulating forever', () => {
    const rl = new RateLimiter({ windowMs: 1_000 });
    for (let i = 0; i < 500; i++) rl.hit(`ip:${i}`, 10, T0);
    assert.equal(rl.size, 500);

    // On Vercel a cold start disposes of the map, so this leak is invisible. deploy/server.ts
    // is a long-lived process and would keep every one of these entries.
    assert.equal(rl.sweep(T0 + 2_000), 500);
    assert.equal(rl.size, 0);
  });

  test('a key flood is capped, and the cap denies rather than evicting', () => {
    const rl = new RateLimiter({ windowMs: 60_000, maxKeys: 100 });
    for (let i = 0; i < 100; i++) rl.hit(`ip:${i}`, 10, T0);
    assert.equal(rl.size, 100);

    // A new key past the ceiling is refused and NOT admitted by evicting someone else. Evicting
    // would turn the ceiling into a bypass: flood distinct keys and every genuine counter is
    // discarded before it can reach its limit.
    assert.equal(rl.hit('ip:flood', 10, T0).limited, true);
    assert.equal(rl.size, 100, 'no eviction of a live bucket');

    // An already-tracked key keeps working while the map is full — the flood must not lock out
    // callers the limiter is already counting.
    assert.equal(rl.hit('ip:0', 10, T0).limited, false);
  });

  test('once the flood ages out the ceiling admits new keys again', () => {
    const rl = new RateLimiter({ windowMs: 1_000, maxKeys: 10 });
    for (let i = 0; i < 10; i++) rl.hit(`ip:${i}`, 5, T0);
    assert.equal(rl.hit('ip:new', 5, T0).limited, true);

    // Denial must be temporary. A permanent ceiling would be a self-inflicted outage.
    const later = T0 + 2_000;
    assert.equal(rl.hit('ip:new', 5, later).limited, false);
  });
});

// ---------------------------------------------------------------------------------------------
// The pluggable store. A fake Redis REST transport stands in for the network, so these tests
// prove the contract — shared counting, hashed keys, and above all that a broken store never
// fails open — without a server, a token or a mocking library.
// ---------------------------------------------------------------------------------------------

const SHARED = { url: 'https://store.invalid/', token: 'test-token', timeoutMs: 50, keyPrefix: 'test:rl' };

/** A minimal Redis that understands the three commands the limiter pipelines. */
function fakeRedis() {
  const data = new Map();
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const results = JSON.parse(init.body).map(([cmd, key, ...args]) => {
      if (cmd === 'SET') {
        if (data.has(key)) return { result: null };
        data.set(key, { value: Number(args[0]), ttl: Number(args[2]) });
        return { result: 'OK' };
      }
      if (cmd === 'INCR') {
        const entry = data.get(key) ?? { value: 0, ttl: -1 };
        entry.value += 1;
        data.set(key, entry);
        return { result: entry.value };
      }
      if (cmd === 'PTTL') return { result: data.get(key)?.ttl ?? -2 };
      return { error: `ERR unknown command ${cmd}` };
    });
    return { ok: true, status: 200, json: async () => results };
  };
  return { fetch, calls, data };
}

describe('createRateLimiter — memory store', () => {
  test('enforces the limit through the async contract', async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, store: 'memory' });
    assert.equal((await limiter.hit('k', 2)).limited, false);
    assert.equal((await limiter.hit('k', 2)).limited, false);
    assert.equal((await limiter.hit('k', 2)).limited, true);
  });

  test('redis-rest without a URL or token degrades to memory and says so', async () => {
    const reasons = [];
    const limiter = createRateLimiter({
      windowMs: 60_000,
      store: 'redis-rest',
      shared: { ...SHARED, url: '' },
      onFallback: (r) => reasons.push(r),
    });
    assert.equal(reasons.length, 1, 'a misconfigured shared store was silent');
    assert.equal((await limiter.hit('k', 1)).limited, false);
    assert.equal((await limiter.hit('k', 1)).limited, true, 'the degraded limiter did not enforce');
  });
});

describe('createRateLimiter — shared Redis REST store', () => {
  test('two replicas spend ONE budget', async () => {
    const redis = fakeRedis();
    const replicaA = createRateLimiter({ windowMs: 60_000, store: 'redis-rest', shared: SHARED, fetch: redis.fetch });
    const replicaB = createRateLimiter({ windowMs: 60_000, store: 'redis-rest', shared: SHARED, fetch: redis.fetch });

    assert.equal((await replicaA.hit('user:1', 3)).limited, false);
    assert.equal((await replicaB.hit('user:1', 3)).limited, false);
    assert.equal((await replicaA.hit('user:1', 3)).limited, false);
    // With per-process memory this 4th request would pass on replica B.
    assert.equal((await replicaB.hit('user:1', 3)).limited, true, 'replicas did not share a budget');
  });

  test('sets the window expiry only when the counter is created', async () => {
    const redis = fakeRedis();
    const limiter = createRateLimiter({ windowMs: 60_000, store: 'redis-rest', shared: SHARED, fetch: redis.fetch });
    await limiter.hit('k', 5);
    const [set] = JSON.parse(redis.calls[0].init.body);
    assert.deepEqual(set.slice(2), ['0', 'PX', '60000', 'NX'], 'expiry is not set-if-absent');
    assert.equal(redis.calls[0].url, 'https://store.invalid/pipeline', 'trailing slash not normalised');
    assert.equal(redis.calls[0].init.headers.Authorization, 'Bearer test-token');
  });

  test('never sends the raw key — addresses are hashed before they leave the process', async () => {
    const redis = fakeRedis();
    const limiter = createRateLimiter({ windowMs: 60_000, store: 'redis-rest', shared: SHARED, fetch: redis.fetch });
    await limiter.hit('ip:203.0.113.7', 5);
    const body = redis.calls[0].init.body;
    assert.ok(!body.includes('203.0.113.7'), 'the IP address reached the shared store in the clear');
    assert.match(JSON.parse(body)[1][1], /^test:rl:[0-9a-f]{64}$/);
  });

  test('a store error falls back to the local limiter, which still enforces', async () => {
    const reasons = [];
    const failing = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const limiter = createRateLimiter({
      windowMs: 60_000, store: 'redis-rest', shared: SHARED, fetch: failing, onFallback: (r) => reasons.push(r),
    });
    assert.equal((await limiter.hit('k', 1)).limited, false);
    assert.equal((await limiter.hit('k', 1)).limited, true, 'the limiter failed OPEN when the store was down');
    assert.ok(reasons.every((r) => !r.includes('test-token')), 'a fallback reason leaked the token');
    assert.equal(reasons.length, 2);
  });

  test('a network exception falls back rather than throwing into the handler', async () => {
    const throwing = async () => { throw new Error('ECONNRESET'); };
    const limiter = createRateLimiter({ windowMs: 60_000, store: 'redis-rest', shared: SHARED, fetch: throwing });
    const result = await limiter.hit('k', 1);
    assert.equal(result.limited, false);
  });

  test('a hung store is abandoned at the timeout, not waited on', async () => {
    const hanging = (_url, init) =>
      new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    const limiter = createRateLimiter({ windowMs: 60_000, store: 'redis-rest', shared: SHARED, fetch: hanging });
    const started = Date.now();
    await limiter.hit('k', 1);
    assert.ok(Date.now() - started < 1_000, 'the request waited on a hung store');
  });

  test('a per-command error inside a 200 response is treated as a failure', async () => {
    const reasons = [];
    const partial = async () => ({ ok: true, status: 200, json: async () => [{ result: 'OK' }, { error: 'ERR' }, { result: 1 }] });
    const limiter = createRateLimiter({
      windowMs: 60_000, store: 'redis-rest', shared: SHARED, fetch: partial, onFallback: (r) => reasons.push(r),
    });
    await limiter.hit('k', 1);
    assert.equal(reasons.length, 1, 'a partial store failure was accepted as a count');
  });

  test('a counter left without an expiry is repaired, not left to lock the key out forever', async () => {
    // The pipeline is not a transaction: the key can expire between SET NX and INCR, and INCR then
    // recreates it with no TTL. Simulate exactly that state.
    const redis = fakeRedis();
    const limiter = createRateLimiter({ windowMs: 60_000, store: 'redis-rest', shared: SHARED, fetch: redis.fetch });
    const fetchWithRace = async (url, init) => {
      const cmds = JSON.parse(init.body);
      if (cmds[0][0] === 'SET') {
        const res = await redis.fetch(url, init);
        const body = await res.json();
        body[2] = { result: -1 };
        return { ok: true, status: 200, json: async () => body };
      }
      redis.calls.push({ url, init });
      return { ok: true, status: 200, json: async () => [{ result: 1 }] };
    };
    const racing = createRateLimiter({ windowMs: 60_000, store: 'redis-rest', shared: SHARED, fetch: fetchWithRace });
    const result = await racing.hit('k', 5);
    const repair = redis.calls.map((c) => JSON.parse(c.init.body)).find((cmds) => cmds[0][0] === 'PEXPIRE');
    assert.ok(repair, 'no PEXPIRE was sent for a key without expiry');
    assert.equal(repair[0][2], '60000');
    assert.equal(result.limited, false);
    // A normal hit never pays for the repair round trip.
    const before = redis.calls.length;
    await limiter.hit('other', 5);
    assert.equal(redis.calls.length, before + 1, 'a key with a TTL triggered a second round trip');
  });

  test('an unknown store name is reported, not silently treated as memory', async () => {
    const reasons = [];
    const limiter = createRateLimiter({ windowMs: 60_000, store: 'redis', onFallback: (r) => reasons.push(r) });
    assert.equal(reasons.length, 1);
    assert.match(reasons[0], /unknown RATE_LIMIT_STORE "redis"/);
    assert.equal((await limiter.hit('k', 1)).limited, false);
    assert.equal((await limiter.hit('k', 1)).limited, true, 'the fallback limiter does not enforce');
  });

  test('refuses to send the token over plain http to a remote store', async () => {
    const reasons = [];
    const redis = fakeRedis();
    const limiter = createRateLimiter({
      windowMs: 60_000, store: 'redis-rest', shared: { ...SHARED, url: 'http://store.invalid/' },
      fetch: redis.fetch, onFallback: (r) => reasons.push(r),
    });
    await limiter.hit('k', 1);
    assert.equal(redis.calls.length, 0, 'the bearer token was sent over plain http');
    assert.match(reasons[0], /https/);
  });

  test('a repair the store refuses falls back and is reported, never silently accepted', async () => {
    const reasons = [];
    const fetchRefusingRepair = async (_url, init) => {
      const cmds = JSON.parse(init.body);
      if (cmds[0][0] === 'SET') {
        return { ok: true, status: 200, json: async () => [{ result: null }, { result: 7 }, { result: -1 }] };
      }
      return { ok: true, status: 200, json: async () => [{ error: 'NOPERM this user has no permissions to run the pexpire command' }] };
    };
    const limiter = createRateLimiter({
      windowMs: 60_000, store: 'redis-rest', shared: SHARED, fetch: fetchRefusingRepair, onFallback: (r) => reasons.push(r),
    });
    const result = await limiter.hit('k', 5);
    assert.equal(reasons.length, 1, 'a refused repair was not reported');
    assert.match(reasons[0], /expiry/);
    assert.equal(result.limited, false, 'the local fallback did not decide the request');
  });

  test('plain http is accepted for a store on this machine', async () => {
    const redis = fakeRedis();
    const limiter = createRateLimiter({
      windowMs: 60_000, store: 'redis-rest', shared: { ...SHARED, url: 'http://127.0.0.1:8079' }, fetch: redis.fetch,
    });
    await limiter.hit('k', 1);
    assert.equal(redis.calls.length, 1);
  });
});
