# Scaling

This document does two things: it states what the system has been **measured** to do, and it
maps the path to each next tier with the real limit and the real cost of every step.

It deliberately does not claim a capacity that has not been measured. A number without a
command behind it is marketing, and a reviewer who catches one stops believing the rest of the
repository. Every figure below has a command you can re-run.

---

## 1. Architecture, and why it matters for capacity

```
                    ┌──────────────────────────────┐
   Browser ────────►│ Cloudflare edge              │  static HTML, JS, CSS, media
                    │ (cache)                      │  ── the origin never sees these
                    └──────────────┬───────────────┘
                                   │ cache miss / API only
                    ┌──────────────▼───────────────┐
                    │ Caddy → Node (deploy/server) │  serves out/, mounts /api/*
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────▼───────────────┐
                    │ Supabase (EU, Frankfurt)     │  ◄── THE BINDING CONSTRAINT
                    │ Postgres + Supavisor pooler  │
                    └──────────────────────────────┘
```

The application is a **static export**. There is no server-side rendering, no server
components and no per-request HTML generation. Three consequences follow, and they are the
whole basis of the capacity story:

1. **The marketing site and the app shell are pure cacheable bytes.** With a long TTL on
   hashed assets they are served from the Cloudflare edge and never reach the origin.
2. **The origin is stateless.** Any number of instances can run behind a load balancer with no
   session affinity, because there is no session state on the server to share.
3. **Authorization lives in the database**, not in application middleware. Row Level Security
   is enforced by Postgres on every query regardless of which instance issued it, so adding
   instances cannot weaken it. That is the property that makes horizontal scaling safe rather
   than merely possible.

---

## 2. Measured — static serving path

Re-run with:

```bash
npm run build && npm run build:server
SELF_HOST_PORT=8080 node deploy/generated/server.cjs   # in one shell
npm run test:load -- --url http://127.0.0.1:8080 --concurrency 100 --seconds 8
```

**Environment:** single Node 24 process, one machine, loopback (no network in path).
Measured 2026-09-10. This is a development machine, not the production VPS — treat the
*shape* of the curve as the finding, not the absolute number.

| Concurrency | Throughput | p50 | p95 | p99 | Failed |
|---:|---:|---:|---:|---:|---:|
| 25 | 3,472 req/s | 6.7 ms | 11.5 ms | 14.5 ms | **0** |
| 100 | 3,619 req/s | 26.8 ms | 39.4 ms | 48.2 ms | **0** |
| 300 | 3,657 req/s | 79.4 ms | 106.9 ms | 189.0 ms | **0** |

**What this says.** Throughput is flat at roughly **3,600 req/s** across a twelve-fold increase
in concurrency, while latency rises in direct proportion. That is a saturated single-threaded
server: the process is CPU-bound and the queue is absorbing the extra load. Little's Law
checks out — 3,657 × 0.0794 s ≈ 290, which is the offered concurrency of 300.

**What this does not say.** It is not an application capacity. No database or AI call is in
this path.

**The useful conclusion:** zero failures at 300 concurrent connections, and the bottleneck is
one CPU-bound process — the cheapest and most boring thing in the system to scale. Node's
`cluster` across N cores, or N containers behind Caddy, multiplies this almost linearly
because the process holds no state.

---

## 3. The real ceiling is the database

Static bytes are not the constraint. Every published free-tier limit that actually binds:

| Limit | Free | Where it bites |
|---|---:|---|
| **Pooler (Supavisor) connections** | **200** | **Concurrent database work. This is the ceiling.** |
| Direct Postgres connections | 60 | Why every client goes through the pooler, never direct |
| Realtime peak concurrent | 200 | One per dashboard left open on a technician's phone |
| Database storage | 500 MB | Inspection rows are small; evidence lives in object storage |
| File storage | 1 GB | Photos and signatures |
| Egress bandwidth | 5 GB/mo | Mitigated by edge caching static assets |
| Monthly active users | 50,000 | Auth, not concurrency |
| Inactivity pause | **1 week** | Why `supabase-keepalive.yml` exists |

**A connection is not a user.** Requests hold a pooler connection only for the duration of a
query — single-digit milliseconds for these queries. Two hundred pooler connections therefore
serve far more than two hundred people; what they cannot survive is two hundred *simultaneous
in-flight queries*. Concurrent inspection submissions are the workload that gets there first.

**Honest statement of current capacity:** the static tier has been measured at ~3,600 req/s
with zero errors at 300 concurrent on one process. The database tier has **not** been load
tested, so no concurrent-user figure is claimed here. Doing that requires generating
authenticated tenants against the live free-tier project, which risks tripping its limits, and
is recorded as the next piece of work rather than guessed at.

---

## 4. The ladder

Each step names the limit it lifts and what it costs. **Nothing beyond step 0 is enabled in
this repository** — every paid step is listed so the path is visible and costed, not because
it is running.

### Step 0 — free tier (current)

- 200 pooler connections, 500 MB database, 5 GB egress
- Single container on a shared VPS behind Caddy and Cloudflare
- Config: `SUPABASE_TIER=free` (the default in `.env.example`)
- **Cost: $0**

Work already done here that does not need a paid plan:

- Static export served from the edge, so most traffic never touches the origin
- Long-TTL immutable hashed assets, short-TTL HTML — `config.scale.edgeCacheSeconds`
- Stateless origin: authorization in Postgres RLS, no server session state
- Rate limiting on `/api/analyze`
- Client-side image downscale before upload, cutting both bandwidth and storage

### Step 1 — multiply the origin process (still $0)

The measured bottleneck is one CPU-bound Node process. Run one container per core behind the
existing Caddy reverse proxy. No code change: the origin is already stateless.

Expected effect: near-linear multiple of 3,600 req/s. **Cost: $0** on the existing VPS, bounded
by its core count.

### Step 2 — Supabase Pro — $25/month

Lifts pooler connections 200 → 500, Realtime peak 200 → 500, database 500 MB → 8 GB, and adds
7-day point-in-time recovery and the leaked-password protection currently reimplemented
client-side against the same corpus.

Change required: `SUPABASE_TIER=pro`, `SCALE_POOLER_CONNECTIONS=500`,
`SCALE_REALTIME_PEAK=500`. **One environment variable set, no code change** — which is the
claim this configuration layer exists to make verifiable.

### Step 3 — read replicas — from ~$0.02/hour per replica

Reporting and dashboard reads are the heaviest queries and never need the primary. Route them
to a replica and the primary's connection budget is reserved for inspection writes.

The routing seam exists in `src/lib/supabase.ts`; the replica client is commented there with
the reason, because the URL does not exist until a replica is provisioned. That comment is a
documented upgrade path, not dead code pretending to be a feature.

### Step 4 — Team tier and multi-region — $599/month

1,000 pooler connections, SOC 2 reporting, SSO. Multi-region read replicas put reads near the
user; the EU primary stays authoritative, which also keeps the GDPR position intact.

### What is genuinely hard beyond that

At sustained six-figure concurrency the honest answer stops being a plan and becomes a
research project: sharding tenants across projects, moving evidence to a dedicated object
store with its own CDN, and replacing Realtime with a purpose-built fan-out. Anyone who tells
you they have a costed plan for a million concurrent users before they have measured ten
thousand is guessing. The measurements above are the first rung, and they are real.

---

## 5. Availability

The keepalive workflow exists because a free-tier project **pauses after one week of
inactivity** — a scheduled ping is what keeps a demo deployment reachable. That is an honest
description of a free-tier constraint, not a high-availability design.

Real availability work that is done: the origin is stateless and restartable, Cloudflare
absorbs origin downtime for cached assets, the client queues inspections in IndexedDB and
syncs when the connection returns, and the hero falls back to a static composition on an
eight-second load budget rather than hanging.

**No uptime percentage is claimed.** A single container on a shared VPS with no redundancy has
not earned a number, and inventing one would be the same mistake as inventing a user count.
Step 1 of the ladder — multiple containers behind Caddy — is the first change that would make
an availability target meaningful.
