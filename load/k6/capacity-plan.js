// k6 capacity plan for the EquipCert serving path.
//
// WHAT THIS IS
//
// The executable form of docs/SCALING.md §5. Each profile is a hypothesis with pass/fail
// thresholds attached, so "designed for 10k concurrent" becomes a command whose result is either
// green or red — never a sentence nobody can check. Until a profile has been RUN against a named
// environment and its result recorded in SCALING.md, it is a plan, not a measurement.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
// - It never sends an image to /api/analyze. A real analysis costs money per call at the AI
//   provider. The API scenario sends unauthenticated requests, which the handler must reject
//   (401) or rate-limit (429) BEFORE any provider or database work — that rejection path is
//   exactly what an attacker or a traffic spike exercises first.
// - It refuses a non-local target unless ALLOW_REMOTE=1. Load against a shared host or a
//   free-tier database is a denial-of-service on yourself (SECURITY.md forbids it for others).
//
// PROFILES (PROFILE=...)
//
//   smoke   20 VUs, 30 s          — proves the script and the thresholds work. Run first.
//   10k     ramp to 10,000 VUs    — the single-generator ceiling; needs a generator with
//                                   ~10 GB RAM and raised file-descriptor limits (ulimit -n).
//   100k    ramp to 100,000 VUs   — distributed only: split with --execution-segment across
//                                   10+ generators, or run under the k6 operator on Kubernetes.
//   1m      ramp to 1,000,000 VUs — distributed only, 100+ generators. Listed so the plan is
//                                   complete, not because anyone should expect to run it cheaply.
//
// A VU here is a concurrent browser session with think time, not a request per second. At the
// think time below, 10,000 VUs offer roughly 3,000–5,000 requests per second, most of which a
// CDN would absorb in production (see SCALING.md for the arithmetic).
//
// Usage:
//   docker run --rm -i --network host -e BASE_URL=http://127.0.0.1:8080 -e PROFILE=smoke \
//     grafana/k6 run - < load/k6/capacity-plan.js
//   k6 run -e BASE_URL=... -e PROFILE=10k load/k6/capacity-plan.js
//   k6 run --execution-segment 0:1/10 --execution-segment-sequence 0,1/10,...,1 -e PROFILE=100k ...

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const PROFILE = __ENV.PROFILE || 'smoke';
const THINK_SECONDS = Number(__ENV.THINK_SECONDS || 2);

const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|host\.docker\.internal)(:\d+)?$/;
if (!LOCAL.test(BASE_URL) && __ENV.ALLOW_REMOTE !== '1') {
  throw new Error(
    `Refusing to load-test ${BASE_URL}: not a local target. Set ALLOW_REMOTE=1 only for an ` +
      'environment you own and have provisioned for this test.',
  );
}

/** Peak VUs and ramp shape per profile. Ramps are gradual so autoscaling has time to react. */
const PROFILES = {
  smoke: { peak: 20, stages: [['10s', 1], ['20s', 1]] },
  '10k': { peak: 10_000, stages: [['2m', 0.1], ['5m', 0.5], ['5m', 1], ['10m', 1], ['3m', 0]] },
  '100k': { peak: 100_000, stages: [['5m', 0.1], ['10m', 0.5], ['10m', 1], ['15m', 1], ['5m', 0]] },
  '1m': { peak: 1_000_000, stages: [['10m', 0.1], ['20m', 0.5], ['20m', 1], ['20m', 1], ['10m', 0]] },
};

const profile = PROFILES[PROFILE];
if (!profile) throw new Error(`Unknown PROFILE "${PROFILE}". One of: ${Object.keys(PROFILES).join(', ')}`);

const stages = profile.stages.map(([duration, fraction]) => ({
  duration,
  target: Math.max(fraction === 0 ? 0 : 1, Math.round(profile.peak * fraction)),
}));

/** API requests rejected before any work: 401/405/429 are success for this scenario. */
const apiRejectedCheaply = new Rate('api_rejected_cheaply');

export const options = {
  discardResponseBodies: true,
  scenarios: {
    // 95% of sessions: a visitor or an app user loading pages and assets.
    browse: {
      executor: 'ramping-vus',
      exec: 'browse',
      startVUs: 0,
      stages: stages.map((s) => ({ ...s, target: Math.ceil(s.target * 0.95) })),
      gracefulRampDown: '30s',
    },
    // 5%: unauthenticated API traffic, the path a spike or an abuser hits first.
    api: {
      executor: 'ramping-vus',
      exec: 'api',
      startVUs: 0,
      stages: stages.map((s) => ({ ...s, target: Math.max(s.target === 0 ? 0 : 1, Math.floor(s.target * 0.05)) })),
      gracefulRampDown: '30s',
    },
    // A load balancer's view: readiness must stay green under load, or instances get ejected.
    readiness: {
      executor: 'constant-arrival-rate',
      exec: 'readiness',
      rate: 1,
      timeUnit: '1s',
      duration: stages.reduce((sum, s) => sum + seconds(s.duration), 0) + 's',
      preAllocatedVUs: 2,
    },
  },
  thresholds: {
    // The SLOs from docs/AVAILABILITY.md, as gates. A red threshold fails the run (exit 99).
    'http_req_failed{scenario:browse}': ['rate<0.01'],
    'http_req_duration{scenario:browse}': ['p(95)<500', 'p(99)<1500'],
    'checks{scenario:readiness}': ['rate>0.999'],
    'http_req_duration{scenario:readiness}': ['p(99)<1000'],
    api_rejected_cheaply: ['rate>0.99'],
    'http_req_duration{scenario:api}': ['p(95)<300'],
  },
};

function seconds(duration) {
  const m = /^(\d+)(s|m|h)$/.exec(duration);
  if (!m) throw new Error(`Unsupported duration ${duration}`);
  return Number(m[1]) * { s: 1, m: 60, h: 3600 }[m[2]];
}

// Routes as the static export actually serves them (out/privacy.html is served at /privacy).
const PAGES = ['/', '/privacy', '/terms', '/auth/login'];

export function browse() {
  const page = PAGES[Math.floor(Math.random() * PAGES.length)];
  const res = http.get(`${BASE_URL}${page}`, { tags: { name: 'page' } });
  check(res, { 'page 200': (r) => r.status === 200 });
  sleep(THINK_SECONDS * (0.5 + Math.random()));
}

export function api() {
  // No Authorization header and a tiny body: must be refused before the provider is called.
  const res = http.post(`${BASE_URL}/api/analyze`, JSON.stringify({ image: '' }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'api-analyze-unauth' },
    responseCallback: http.expectedStatuses(401, 405, 429),
  });
  apiRejectedCheaply.add([401, 405, 429].includes(res.status));
  check(res, { 'api refused, not served': (r) => [401, 405, 429].includes(r.status) });
  sleep(THINK_SECONDS * (0.5 + Math.random()));
}

export function readiness() {
  const res = http.get(`${BASE_URL}/readyz`, { tags: { name: 'readyz' } });
  check(res, { 'ready 200': (r) => r.status === 200 });
}
