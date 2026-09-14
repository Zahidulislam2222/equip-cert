# Availability

This document separates three things that are routinely blurred:

| Label | Meaning |
|---|---|
| **Measured** | A command was run and the number came out of it. The command is given. |
| **Verified behaviour** | A test exercised the mechanism for real and it did what it claims. |
| **Design target** | What the architecture is built to reach *on the named deployment tier*. Not a promise and not a measurement. |

**No uptime figure is claimed for the current deployment.** It is a single container on a shared
VPS with a free-tier database. The Terms of Service say the same thing: there is no SLA.

---

## 1. Service level objectives — design targets per tier

| Tier | Deployment | Availability SLO (30 days) | Error budget | Latency SLO |
|---|---|---:|---:|---|
| 0 — current | 1 container, shared VPS, Supabase Free | **none claimed** | — | — |
| 1 — redundant origin | ≥ 2 replicas behind Caddy `least_conn` + health checks, Supabase Pro | 99.9 % | 43 min 12 s | p95 < 500 ms for pages, p95 < 300 ms for API rejections |
| 2 — orchestrated | Kubernetes manifests in `deploy/k8s/` (3–50 pods, PDB, HPA), multi-node, Supabase Pro + read replica | 99.95 % | 21 min 36 s | same |

Error budget = (1 − SLO) × 30 days. 99 % would allow **7 h 12 min** a month of downtime — the
figure the owner asked about is comfortably inside tier 1's target, but it is a *target* until a
tier-1 deployment has run for a month and its monitor says so.

**Ceiling you cannot engineer past from this repository:** the database provider's own
availability. An origin at 99.99 % in front of a single-region managed database inherits that
database's availability. Check the provider's current published SLA for the plan in use before
quoting any end-to-end number.

### How each SLO is measured

| Signal | Source | Status |
|---|---|---|
| External availability | `.github/workflows/production-check.yml` — every 30 min: site 200, `/healthz`, `/readyz`, headers, API method guard, compiled backend matches the intended one | **Built.** 30-minute resolution is too coarse for a 99.95 % budget; tier 2 needs a 1-minute external monitor |
| Latency / error rate under load | `load/k6/capacity-plan.js` thresholds (`http_req_failed < 1 %`, p95/p99) | **Built, `k6 inspect` valid. Not yet run against a tier-1 environment** |
| Readiness under load | same script, `readiness` scenario, `checks > 99.9 %` | Built, not yet run |

---

## 2. Mechanisms that keep requests from failing

### 2.1 Liveness vs readiness — verified behaviour

`deploy/server.ts` exposes two probes on purpose:

- **`/healthz` (liveness)** — "can this process serve at all?" Dependency-free. A liveness probe
  that checked the database would restart every replica at once during a database blip.
- **`/readyz` (readiness)** — "should the load balancer send this replica new traffic?" Returns
  `503 draining` during shutdown. A draining replica is healthy and must not be restarted.

### 2.2 Graceful drain — verified behaviour; zero-downtime only with ≥ 2 replicas

**Scope first.** Draining lets a load balancer move traffic to *another* replica. With
`replicas: 1` — the current VPS — there is no other replica: `/readyz` going 503 marks the only
upstream unhealthy, and `compose up` replaces the container on the same port, so a deploy there
still drops requests for a few seconds. Zero-downtime is a property of tier 1 and above (§1), with
a rolling procedure that replaces one replica at a time. What the test below verifies is the drain
**sequence**, which is the prerequisite — not zero downtime itself, which has not been measured.

On `SIGTERM`:

1. `/readyz` flips to 503 while the listener stays open, for `SELF_HOST_DRAIN_DELAY_MS`
   (default 5 s). Caddy checks `/readyz` every 2 s (`deploy.config.json` → `proxy`), so it stops
   routing here before the listener closes. Requests already routed still succeed, and carry
   `Connection: close` so keep-alive clients move to another replica.
2. The listener closes; idle keep-alive sockets close immediately; in-flight requests finish.
3. A hard deadline (`SELF_HOST_SHUTDOWN_GRACE_MS`, 20 s) destroys whatever remains, so one hung
   upstream call cannot block a deploy. Exit code 0 = clean, 1 = deadline hit.

The container stop grace (30 s) and the Kubernetes `terminationGracePeriodSeconds` are generated
from the same config and are asserted to exceed drain + grace, so the orchestrator never SIGKILLs
mid-drain. `gen-deploy-artifacts.mjs` refuses to generate a config that breaks that ordering.

**Evidence** — `tests/server_drain_test.mjs`, run in the production Node image (the Dockerfile's
pinned digest), against the built `deploy/generated/server.cjs`, 2026-09-14: **13/13**.

```
/readyz 200 "ready" while serving; not cacheable
after SIGTERM /readyz 503 "draining"; process still serves; responses carry Connection: close
process exits 0 after 3011 ms with a 3000 ms drain delay (not the hard deadline)
slow-headers client cut off with "HTTP/1.1 408 Request Timeout" after 2116 ms (timeout 2000 ms)
```

That last line found a real defect. Node enforces `headersTimeout` only on its
`connectionsCheckingInterval`, which defaults to **30 s** — so a configured 15 s header timeout
was really 15–45 s. The same test against a bundle without the fix: the slow client was **still
connected after 8 s**. The server now derives the interval from its own timeouts.

### 2.3 Keep-alive ordering

Caddy's upstream keep-alive (60 s) is shorter than Node's `keepAliveTimeout` (65 s). If the order
were reversed, the proxy would reuse a socket at the instant Node closes it and return an
intermittent 502 that no log explains. The generator asserts the ordering.

### 2.4 Redundancy

| Layer | Tier 1 | Tier 2 |
|---|---|---|
| Origin | `replicas: N` → N compose services, Caddy pool, active health checks, `lb_try_duration` retries | Deployment, `maxUnavailable: 0`, topology spread across nodes, PDB `minAvailable: 2`, HPA 3→50 at 65 % CPU |
| Rate limiting | shared Redis-REST store so N replicas enforce one budget; falls back to per-process limits, never fails open | same |
| Static assets | Cloudflare edge cache keeps serving cached bytes through an origin outage | same |
| Database | managed by Supabase; daily backups on paid plans | + read replica for lag-tolerant reads |
| Technician in the field | inspections queue in IndexedDB and sync on reconnect — an outage delays a submission, it does not lose it | same |

The origin holds no session state, which is what makes every row above possible without sticky
sessions.

---

## 3. Failure modes

| Failure | Detection | Automatic response | User impact | Runbook |
|---|---|---|---|---|
| One origin replica crashes | health check fails (≤ 2 s interval, 10 s fail window) | removed from pool; container `restart: unless-stopped` / pod restarted | in-flight requests on that replica fail; retried by Caddy within `lb_try_duration` | R1 |
| Rolling deploy, ≥ 2 replicas | readiness 503 | drained before close | designed: none (drain sequence verified, §2.2; not load-measured) | R2 |
| Deploy, 1 replica (current VPS) | — | none | seconds of failed requests during the container swap | R2 |
| All replicas down / VPS down | production-check (≤ 30 min), external monitor on tier 2 | none on tier 0/1 | static pages from edge cache; app and API unavailable | R3 |
| Database unavailable | app errors; `check-production.mjs` backend probe | none — managed service | sign-in and data unavailable; technicians keep working offline, queue syncs later | R4 |
| Database connection exhaustion | pooler errors under load | none | slow/failed reads and writes | R5 |
| Shared rate-limit store down | `console.warn` fallback reason | per-process limiting | none; limits are per replica until it recovers | R6 |
| AI provider outage or quota | `/api/analyze` 5xx | none | analysis unavailable; technician completes the checklist manually — the model only ever proposed | — |
| Slow-headers / slowloris client | — | cut off at `headersTimeout` with 408 (verified) | none | — |
| Free-tier database paused after 7 days idle | production-check | keepalive workflow prevents it | total outage of app data | R4 |
| Wrong backend compiled into the bundle (DEF-058) | production-check compares the compiled Supabase host | none | login dead while the site looks up | R7 |

---

## 4. Recovery objectives — design targets

| Tier | RPO (data loss) | RTO (restore) | Basis |
|---|---|---|---|
| 0 | up to the age of the last manual export — **the free plan includes no backups** | hours, manual | stated as a risk, not a target |
| 1 | ≤ 24 h (daily backups on a paid plan) | ≤ 1 h origin, database per provider restore time | provider backup schedule |
| 2 | minutes, with point-in-time recovery enabled (paid add-on) | ≤ 15 min origin (redeploy manifests) | PITR + declarative manifests |

The origin is rebuilt from Git plus `CREDENTIALS.md`; it holds no data. Every RPO above is
therefore a database property. **No restore drill has been run** — until one is, the RTO column is
a target with no evidence behind it.

---

## 5. Runbooks

**R1 — replica unhealthy.** `docker compose ps` / `kubectl -n equipcert get pods`. Read the last
100 log lines. If it is crash-looping on start, the cause is almost always configuration: compare
`app.env` against `.env.example`. Do not raise `replicas` to hide a crash loop.

**R2 — deploy.** `npm run deploy:gen -- --release <id>`, build, roll. Watch `/readyz` on each
replica flip 503 → gone → new replica 200. Prove SHA-256 parity local vs live (global Rule 9).
Roll back by redeploying the previous release id recorded in `CREDENTIALS.md`.

**R3 — origin down.** Confirm from outside (`npm run test:production`). SSH to the host, check
Docker, disk, memory. If the host is gone, the origin is reproducible from Git: provision, restore
`app.env` from `CREDENTIALS.md`, regenerate artifacts, deploy.

**R4 — database down or paused.** Check the provider status page and the project dashboard. A
paused free project is resumed from the dashboard. Do not "fix" by pointing the build at another
project without also updating `NEXT_PUBLIC_SUPABASE_URL` — that is exactly DEF-058.

**R5 — connection exhaustion.** Confirm clients use the pooler, not direct connections. Short
term: move lag-tolerant reads to a replica (`NEXT_PUBLIC_SUPABASE_READ_REPLICA_URL`). Long term:
next plan tier; see `docs/SCALING.md`.

**R6 — rate-limit store down.** Nothing to do urgently; the service degrades to per-process
limits. Restore the store; the warning stops.

**R7 — wrong backend in the bundle.** Rebuild with the correct `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_APP_URL`, redeploy, rerun `npm run test:production`.

---

*Every design target in this document is conditional on the tier it names. None describes the
current deployment.*
