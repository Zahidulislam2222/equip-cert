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
