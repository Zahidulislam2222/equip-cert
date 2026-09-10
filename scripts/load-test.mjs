#!/usr/bin/env node
/**
 * Load harness for the production serving path.
 *
 * WHY THIS EXISTS AND WHAT IT IS NOT
 *
 * "Scales to a million users" is not an engineering claim, it is a wish. This measures what
 * the thing actually does, so the number in docs/SCALING.md has a command behind it that
 * anyone can re-run. A reviewer who does not trust the figure can reproduce it in one line,
 * which is the only reason to believe any figure.
 *
 * Zero dependencies on purpose. k6 is the better tool and the right answer at scale, but it
 * needs an install, and a benchmark nobody can run is a benchmark nobody checks.
 *
 * WHAT IT MEASURES: the static-export serving path — `deploy/server.ts` in front of `out/`,
 * which is what the VPS runs. That path involves no database and no AI call.
 *
 * WHAT IT DOES NOT MEASURE: database concurrency, which is the real ceiling for this
 * application (see docs/SCALING.md §3). Do not quote a number from here as an application
 * capacity. It is the capacity of the layer that serves bytes, and its value is showing how
 * much traffic never reaches the database at all.
 *
 * Usage:
 *   node scripts/load-test.mjs --url http://127.0.0.1:8080 --concurrency 50 --seconds 10
 *   npm run test:load
 */

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
}

const URL_ = args.get('url') || 'http://127.0.0.1:8080';
const CONCURRENCY = Number(args.get('concurrency') || 50);
const SECONDS = Number(args.get('seconds') || 10);
const PATHS = (args.get('paths') || '/,/privacy,/terms').split(',');

/** Nanosecond clock -> milliseconds, avoiding Date's 1ms granularity on Windows. */
const nowMs = () => Number(process.hrtime.bigint() / 1000n) / 1000;

const latencies = [];
let ok = 0;
let failed = 0;
const statusCounts = new Map();
let stop = false;

async function worker(id) {
  let i = id;
  while (!stop) {
    const path = PATHS[i++ % PATHS.length];
    const started = nowMs();
    try {
      const res = await fetch(`${URL_}${path}`, { redirect: 'manual' });
      // Drain the body. Without this the socket is not actually free and the numbers flatter
      // us — we would be measuring time-to-headers, not time-to-served.
      await res.arrayBuffer();
      latencies.push(nowMs() - started);
      statusCounts.set(res.status, (statusCounts.get(res.status) || 0) + 1);
      if (res.status >= 200 && res.status < 400) ok++;
      else failed++;
    } catch {
      failed++;
      latencies.push(nowMs() - started);
    }
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

console.log(`  target      ${URL_}`);
console.log(`  paths       ${PATHS.join(' ')}`);
console.log(`  concurrency ${CONCURRENCY}`);
console.log(`  duration    ${SECONDS}s\n`);

// Fail fast and loudly rather than reporting a confident zero against a dead server.
try {
  const probe = await fetch(`${URL_}${PATHS[0]}`);
  await probe.arrayBuffer();
  if (!probe.ok) throw new Error(`probe returned HTTP ${probe.status}`);
} catch (err) {
  console.error(`✗ Target is not serving: ${err instanceof Error ? err.message : err}`);
  console.error('  Start it first (npm run build && npm run build:server && node deploy/generated/server.cjs)');
  process.exit(1);
}

const startedAt = nowMs();
const workers = Array.from({ length: CONCURRENCY }, (_, i) => worker(i));
setTimeout(() => {
  stop = true;
}, SECONDS * 1000);
await Promise.all(workers);
const elapsedSec = (nowMs() - startedAt) / 1000;

const sorted = latencies.slice().sort((a, b) => a - b);
const total = ok + failed;
const rps = total / elapsedSec;

console.log(`  requests    ${total}  (${ok} ok, ${failed} failed)`);
console.log(`  throughput  ${rps.toFixed(0)} req/s over ${elapsedSec.toFixed(1)}s`);
console.log(`  latency     p50 ${percentile(sorted, 50).toFixed(1)}ms · p95 ${percentile(sorted, 95).toFixed(1)}ms · p99 ${percentile(sorted, 99).toFixed(1)}ms · max ${sorted[sorted.length - 1]?.toFixed(1)}ms`);
console.log(`  statuses    ${[...statusCounts.entries()].map(([s, c]) => `${s}:${c}`).join(' ')}`);

if (failed > 0) {
  console.log(`\n  ${failed} request(s) failed. A load result with failures is a capacity finding, not a bad run — record it.`);
}
