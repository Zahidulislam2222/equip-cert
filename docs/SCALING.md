# Scaling

This document answers one question: **what would it take for this codebase to serve 10,000,
100,000 or 1,000,000 concurrent users, and how much of that is already built?**

It uses three labels and never mixes them:

| Label | Meaning |
|---|---|
| **Measured** | A command produced the number. The command is given so you can re-run it. |
| **Built** | The code or configuration exists in this repository and has been validated (tests, `caddy validate`, `kubeconform`, `k6 inspect`). |
| **Designed for** | What the architecture is built to reach on a named tier. Not a measurement. |

**The current deployment serves none of these numbers and claims none of them.** It is one
container on a shared VPS with a free-tier database. What this repository demonstrates is that
getting from here to there is configuration and provisioning, not a rewrite.

---

## 1. Why this architecture scales — the three properties

```
                    ┌──────────────────────────────┐
   Browser ────────►│ CDN edge (Cloudflare)        │  static HTML, JS, CSS, media
   Flutter app      │                              │  ── the origin never sees these
                    └──────────────┬───────────────┘
                                   │ cache miss / API only
                    ┌──────────────▼───────────────┐
                    │ Load balancer                │  Caddy least_conn + /readyz checks
                    │                              │  or a Kubernetes Service
                    └──────┬────────┬────────┬─────┘
                           ▼        ▼        ▼
                    ┌────────┐┌────────┐┌────────┐
                    │ Node   ││ Node   ││ Node   │  deploy/server.ts, stateless
                    │ origin ││ origin ││ origin │  N = 1 … 50 (HPA)
                    └───┬────┘└───┬────┘└───┬────┘
                        └────────┬┴─────────┘        shared rate-limit store (Redis REST)
                    ┌────────────▼─────────────────┐
                    │ Supabase Postgres (EU)       │  ◄── THE BINDING CONSTRAINT
                    │ pooler · RLS · read replica  │
                    └──────────────────────────────┘
```

1. **Static export.** No server rendering, no per-request HTML. Pages and the app shell are
   cacheable bytes served from the edge; with hashed assets and a long TTL most traffic never
   reaches an origin.
2. **Stateless origin.** No session state on the server, so any number of replicas run behind a
   load balancer with no sticky sessions. The one piece of shared state an origin needs — rate
   limit counters — has a shared store (`RATE_LIMIT_STORE=redis-rest`).
3. **Authorization in the database.** Row Level Security is enforced by Postgres on every query,
   whichever replica issued it. Adding replicas, regions or read replicas cannot weaken tenant
   isolation. That is what makes horizontal scaling *safe*, not merely possible.

---

## 2. Measured

### 2.1 Static serving path, one process

```bash
npm run build && npm run build:server
SELF_HOST_PORT=8080 node deploy/generated/server.cjs
npm run test:load -- --url http://127.0.0.1:8080 --concurrency 100 --seconds 8
```

Single Node 24 process, development machine, loopback. Measured 2026-09-10.

| Concurrency | Throughput | p50 | p95 | p99 | Failed |
|---:|---:|---:|---:|---:|---:|
| 25 | 3,472 req/s | 6.7 ms | 11.5 ms | 14.5 ms | **0** |
| 100 | 3,619 req/s | 26.8 ms | 39.4 ms | 48.2 ms | **0** |
| 300 | 3,657 req/s | 79.4 ms | 106.9 ms | 189.0 ms | **0** |

Flat throughput with latency rising in proportion is a saturated, CPU-bound, single-threaded
server — Little's Law checks: 3,657 × 0.0794 s ≈ 290 ≈ 300 offered. **This is not an application
capacity**: no database or AI call is in this path. It establishes that the origin's bottleneck
is one CPU core, the cheapest thing in the system to multiply.

### 2.2 Operational behaviour (verified, not a throughput number)

Zero-downtime drain, readiness flip, and slow-client cut-off — 13/13 in the production Node image.
Details and the defect it found are in `docs/AVAILABILITY.md` §2.2.

### 2.3 Not measured

- **Database tier under load.** Needs authenticated tenants against a provisioned environment;
  running it against the free project would trip its limits and is a denial of service on
  ourselves.
- **Any multi-replica throughput.** The pool and manifests are validated, not load tested.

---

## 3. Capacity model

### 3.1 What a "concurrent user" costs

A concurrent user is a person with the app open, not a request. Assumptions, stated so they can
be argued with:

| Behaviour | Assumption |
|---|---|
| Page / asset requests | one every ~2 s while active; **≥ 90 % served from edge cache** once warm |
| API calls to the origin | a small fraction of sessions: sign-in handled by Supabase Auth, AI analysis when a photo is taken |
| Database queries | dashboard loads and inspection submissions; each holds a pooler connection for single-digit milliseconds |
| Realtime | one socket per open dashboard (notifications) |

### 3.2 The arithmetic per tier

| | **10k concurrent** | **100k concurrent** | **1M concurrent** |
|---|---|---|---|
| Offered HTTP load (÷ 2 s think time) | ~5,000 req/s | ~50,000 req/s | ~500,000 req/s |
| Reaching origin at ≥ 90 % edge hit | ≤ 500 req/s | ≤ 5,000 req/s | ≤ 50,000 req/s |
| Origin processes needed (at the measured ~3,600 req/s/core, **50 % headroom**) | 1 → run **3** for redundancy | ~3 → run **3–6** | ~28 → HPA toward **50** |
| Built for it | `replicas`, Caddy pool, k8s HPA 3→50 | same | same, multi-node |
| Database: concurrent in-flight queries (assume 1 % of users mid-query) | ~100 | ~1,000 | ~10,000 |
| Database tier | Pro-class pooler; read replica for aggregates | larger compute + replicas; connection budget reserved for writes | beyond one Postgres primary — see §5 |
| Realtime sockets (assume 10 % have a dashboard open) | ~1,000 | ~10,000 | ~100,000 |

Origin processes are **extrapolated** from the measured single-core figure and assume near-linear
scaling of a stateless process, which is standard but not measured here. Database rows are
**designed-for** estimates; the free plan's 200 pooler connections and 200 Realtime connections
(§4) are the first things that break, long before the origin does.

### 3.3 The order things break in

1. **Realtime connections** — 200 on the free plan. One open dashboard each.
2. **Pooler connections** — 200 on the free plan. Concurrent inspection submissions get there first.
3. **Auth email** — the shared sender allows 2 messages/hour for the whole project (see
   `supabase/auth-baseline.json`). Password resets stop working long before load does.
4. **AI provider quota** — a per-account rate limit at the provider. `/api/analyze` limits per IP and
   per account so one user cannot spend it for everyone.
5. **Origin CPU** — last, and cheapest to fix.

---

## 4. The ladder

Each step names the limit it lifts, what is already built for it, and whether it costs money.
**Nothing beyond step 0 is provisioned.** Paid steps are listed so the path is visible, not because
they are running; prices change, so check the provider's pricing page before relying on a figure.

| Step | Lifts | Already built | Change required | Cost |
|---|---|---|---|---|
| **0 — current** | — | static export, edge caching headers, RLS, rate limits, offline queue | — | $0 |
| **1 — multiply the origin** | origin CPU | `deploy.config.json` `replicas: N` → N compose services + Caddy `least_conn` pool with `/readyz` checks (`caddy validate` OK at N=3); drain on deploy | set `replicas`, `npm run deploy:gen` | $0 on an existing host, bounded by its cores |
| **2 — shared rate limiting** | N× limit leak across replicas | `RedisRestLimiter`, hashed keys, fail-safe fallback (unit tested, incl. two replicas sharing one budget) | `RATE_LIMIT_STORE=redis-rest` + URL/token | free tiers exist for Redis REST providers |
| **3 — database plan** | pooler 200, Realtime 200, 500 MB, no backups | tier-aware config (`SUPABASE_TIER`, `SCALE_*`) | env vars | paid (Supabase Pro) |
| **4 — read replica** | read load on the primary's connection budget | `supabaseRead` client, config-gated, user JWT bridged so RLS applies; dashboard aggregate routed | `NEXT_PUBLIC_SUPABASE_READ_REPLICA_URL` | paid (replica compute) |
| **5 — orchestration** | single host, manual failover | `deploy/k8s/`: Deployment (`maxUnavailable: 0`, probes, non-root, read-only FS), HPA 3→50, PDB, NetworkPolicy — kubeconform 6/6 valid, drift-checked in CI | a cluster, `kubectl apply -k deploy/k8s` | paid (cluster) |
| **6 — capacity test** | "designed for" → "measured" | `load/k6/capacity-plan.js`: smoke / 10k / 100k / 1m profiles with SLO thresholds; refuses non-local targets without `ALLOW_REMOTE=1` | a provisioned environment + generators | generator compute |

### 4.1 Running the capacity plan

```bash
# prove the script and thresholds against a local build first
docker run --rm -i --network host -e BASE_URL=http://127.0.0.1:8080 grafana/k6 \
  run -e PROFILE=smoke - < load/k6/capacity-plan.js

# 10k from one large generator; 100k and 1m split across generators
k6 run -e BASE_URL=https://staging.example -e ALLOW_REMOTE=1 -e PROFILE=10k load/k6/capacity-plan.js
```

The thresholds are the SLOs in `docs/AVAILABILITY.md`. A run that breaches one exits non-zero.
When a profile has been run, its result replaces the matching "designed for" row above, with the
environment named.

---

## 5. What is genuinely hard beyond that

At sustained seven-figure concurrency the problem stops being configuration. A single Postgres
primary — however large, however many replicas — becomes the write bottleneck, and the honest plan
is: shard tenants across database projects (the schema is already tenant-keyed on
`organization_id` everywhere, which is the prerequisite), move evidence photos to object storage
with their own CDN, and replace per-dashboard Realtime sockets with a purpose-built fan-out.

None of that is built. The codebase is shaped so it can be done without changing the
authorization model — and anyone who presents a finished 1M-concurrent plan without having
measured 10k is guessing. §2 is the first rung, and it is real.
