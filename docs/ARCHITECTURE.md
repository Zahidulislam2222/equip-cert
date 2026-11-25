# Architecture

How EquipCert AI is built, and the decisions behind it. Each decision records **why**, and what
was given up to get it. The scaling and availability consequences are in
[SCALING.md](SCALING.md) and [AVAILABILITY.md](AVAILABILITY.md).

---

## 1. System context

```
   Technician (phone)                 Manager (browser)               Anyone (browser)
   Flutter app, offline queue         Web app /app/*                  Landing, /privacy, /terms,
          │                                  │                        /privacy/requests
          │                                  │                               │
          └──────────────┬───────────────────┴───────────────────────────────┘
                         │ HTTPS
          ┌──────────────▼──────────────┐
          │ CDN edge (Cloudflare)       │   static HTML / JS / CSS / media — cached
          └──────────────┬──────────────┘
                         │ cache miss or /api/*
          ┌──────────────▼──────────────┐
          │ Origin                      │   deploy/server.ts (self-host)  or  Vercel
          │  • static export (out/)     │   same build, same security headers
          │  • /api/analyze             │   AI analysis — JWT required, rate limited
          │  • /api/assist              │   help assistant — JWT required, read-only
          │  • /api/dsar                │   privacy request intake — no account required
          │  • /api/billing/*           │   checkout, portal, seat sync — admin / member
          │  • /api/webhooks/stripe     │   signed payment events — the only plan writer
          └──────┬───────────────┬──────┘
                 │               │ image only, never identity
                 │        ┌──────▼──────────────────┐
                 │        │ Vision AI (config)      │  Gemini · OpenAI · Anthropic
                 │        │ Help AI (config)        │  free models via OpenRouter
                 │        │ Stripe                  │  billing; live payments off until enabled
                 │        └─────────────────────────┘
          ┌──────▼──────────────────────────────────┐
          │ Supabase (EU, Frankfurt)                │
          │  Auth · Postgres + RLS · Storage (private) · Realtime │
          └─────────────────────────────────────────┘
          ┌─────────────────────────────────────────┐
          │ Contentful — checklist templates only,  │  no personal data
          └─────────────────────────────────────────┘
```

Both clients talk to Supabase **directly** with the user's own JWT. Authorization is therefore
enforced where the data lives, not in an API layer that could be bypassed.

## 2. Components

| Component | Path | Responsibility |
|---|---|---|
| Web client | `src/` | Next.js 16 static export: marketing, auth, manager dashboard, technician flow |
| Mobile client | `mobile/` | Flutter Android + iOS; camera, GPS, secure session storage, offline queue — [README](../mobile/README.md) |
| API handlers | `api/` | Standalone `@vercel/node` handlers; imported unmodified by the self-host adapter |
| Self-host adapter | `deploy/server.ts` | Serves `out/`, mounts the handlers, health/readiness probes, graceful drain, HTTP Range for video |
| Database | `supabase/migrations/` | 13 tables from 11 migrations; row-level security on all 13 and `FORCE`d on the 12 holding tenant data; triggers for immutability, server timestamps, plan and seat limits, e-sign consent and the audit log |
| AI help | `api/assist.ts`, `src/lib/assist/`, `src/content/help/` | Retrieval over approved help articles plus a read-only, RLS-scoped account summary — [AI-ASSISTANT.md](AI-ASSISTANT.md) |
| Billing | `api/billing/`, `api/webhooks/stripe.ts`, `src/lib/billing.ts` | Checkout and portal sessions; the signed webhook alone sets the plan |
| Deployment generator | `scripts/gen-deploy-artifacts.mjs` | Emits the Caddy site file, `compose.yaml` and Kubernetes manifests from one config file |
| Configuration | `src/lib/config.ts`, `src/lib/plans.ts`, `deploy/deploy.config.json` | The only owners of environment values, plan data and deployment values |

## 3. Data model

```
organizations ─┬── profiles               role (admin / manager / technician); e-sign consent + version + time
               ├── organization_invites   single-use, expiring; only the token's hash is stored
               ├── billing_events         Stripe event ids, so a repeated delivery is skipped
               ├── equipment              registry, status, next due date (advanced by trigger)
               │   └── schedules          recurring inspections per item
               ├── inspections            checklist results, photos, GPS, signature, AI provenance
               │   └── corrective_actions open → in progress → resolved
               ├── notifications          delivered over Realtime
               ├── consent_records        what a person agreed to, and which policy version
               ├── data_subject_requests  privacy requests with their statutory deadline
               └── audit_log              append-only; written by triggers in the same transaction
plan_limits                                generated from src/lib/plans.ts
```

Every tenant-owned table carries `organization_id` and a row-level security policy. Inspection
record times are set by a database trigger that overwrites any `created_at` a client sends, so an
inspection cannot be backdated. Other tables use a `DEFAULT now()` that a client could still
override; extending the trigger to them is on the [roadmap](ROADMAP.md).

## 4. Key flows

**Inspection.** Technician photographs equipment → `/api/analyze` verifies the JWT, applies
per-IP and per-account limits, rejects images over the size cap (the client has already downscaled
them) and forwards the image to the configured AI provider →
the result returns labelled as AI-derived → the technician answers the checklist, confirms or
overrides every AI suggestion, and gives explicit consent to sign electronically, which the
database stores on their profile with the wording version and the server time → the technician signs →
the row is saved with its provenance. The database refuses a signature without recorded consent,
or on a plan that does not include signatures, whether it arrives as an insert or a later update.
From then on a trigger rejects any `UPDATE` or `DELETE` of the signed record. A failed checklist
item opens a corrective action, and a database trigger advances the equipment's next due date and
its schedule from the inspection.

**Joining an organisation.** An administrator creates an invitation for a role; the link carries a
single-use token that expires, and only its hash is stored. The invitee signs up or signs in and
accepts; a trigger enforces the plan's member limit on every join. Nobody can attach themselves to
an organisation without an invitation, and nobody chooses their own role.

**Billing.** An administrator starts Stripe Checkout from Settings. The browser's success redirect
changes nothing: only the signed webhook sets the plan, and it derives the plan from all of the
customer's subscriptions rather than from the single event, so a late or duplicate event cannot
downgrade a paying organisation. Seats are counted by the server. Live payments are switched on
when the operator enables live keys.

**Help.** The assistant retrieves approved help articles and, when needed, a read-only summary of
the caller's organisation read with the caller's own token. It cannot act, keeps no transcript, and
falls back to the closest article when no model answers ([AI-ASSISTANT.md](AI-ASSISTANT.md)).

**Offline.** With no connection, the submission is queued locally (IndexedDB on the web, a
local store on mobile) with a SHA-256 digest over its canonical form. On reconnect the queue
drains — also when the app is reopened already online; a payload whose digest no longer matches is
rejected, not uploaded, and a signed submission queued by a different person is held rather than
filed under whoever is signed in now.

**Evidence files.** Photos and signatures go to a **private** bucket under an
organisation-scoped path with an unguessable object name, and are viewed only through
short-lived signed URLs. (An earlier build used a public bucket with timestamp filenames; the
migration that replaced it explains the three failures it closed.)

**Privacy request.** `/privacy/requests` needs no account — the people most likely to ask for
erasure no longer have one. The endpoint records the request with its legal deadline and does
nothing else: identity must be verified before anything is disclosed or erased.

**Erasure.** The person is separated from the safety record: the inspector is anonymised, the
finding survives, as both GDPR Art. 17 and NFPA 10 retention require.

## 5. Decisions

| # | Decision | Why | Cost accepted |
|---|---|---|---|
| D1 | **Static export**, no server rendering | Every page is cacheable bytes; the edge absorbs most traffic; no server to compromise for page rendering | No middleware, no server components; auth guards are client-side and the database is the real boundary |
| D2 | **Authorization in Postgres (RLS)**, not an API layer | One enforcement point for both clients and every replica; cannot be skipped by calling the database directly | Policies must be tested against a real database — hence the e2e suite |
| D3 | **Flutter** for mobile instead of wrapping the web app | A dependable offline queue, secure token storage and camera control need native access | Two clients; contract tests keep them agreeing on the schema and theme |
| D4 | **AI provider behind an interface**, selected by configuration | No vendor lock-in; model IDs and URLs are configuration, never code | Changing provider is a sub-processor change with legal paperwork |
| D5 | **The AI proposes, a human signs** | Keeps the system outside the AI Act's high-risk classes and keeps accountability with a named person | Slower than auto-accepting a model's answer, by design |
| D6 | **One owner per configuration value**, enforced by `npm run test:config` in the build | Values that are copied drift; the build fails when one escapes its owner | A stricter workflow for adding settings |
| D7 | **Two deployment targets from one build** (Vercel, self-host) | No lock-in to one host; security headers are derived from one source for both | A generator to maintain instead of hand-written proxy config |
| D8 | **Stateless origin** | Horizontal scaling without sticky sessions; the only shared state (rate limits) has a shared store | Rate limits need an external store once there is more than one replica |
| D9 | **EU data residency** (Frankfurt) | Most GDPR transfer questions disappear when primary data never leaves the EEA | US customers' requests cross the Atlantic — acceptable for this workload |
| D10 | **The webhook is the only writer of the plan**, and it re-reads the whole subscription set | A webhook says *something changed*, not *what is true*; a forged redirect or a late event must not change a paying customer's plan | One extra Stripe read per event |
| D11 | **Rules about a state guard every path into it** | Consent, plan and timestamp rules run on insert **and** update, because a rule on the insert alone was bypassed by an update | More triggers to test — each has an integration test |
| D12 | **The help assistant is read-only and uses the caller's own token** | It can never show more than the user could see in the app, and can never act | It cannot complete tasks for the user; it tells them where to do it |

## 6. Delivery pipeline

```
commit ─► pre-commit: gitleaks · bandit · semgrep
push to main / pull request ─► CI: config boundary · plan limits · deploy-manifest drift · unit tests · lint
          · type check · static build · self-host build
          local stack: every migration from scratch · tenancy, invitation, billing and consent
          integration tests · Playwright browser flows + axe, desktop and phone, production CSP
          Flutter: format · analyze (--fatal-infos) · 447 tests · release APK
          · unsigned-when-unconfigured check · built manifest hardening
          iOS: unsigned release build on macOS · built Info.plist check
          live gates: dependencies reachable · generated types match · tenant isolation e2e
          · migrations applied · security and performance advisors
          security: gitleaks · semgrep       dependencies: Dependabot (npm + Actions)
          (documentation-only pushes skip CI)
deploy ─► build with production values ─► generate artifacts ─► upload release
          ─► compose up --wait ─► proxy reload ─► SHA-256 parity local vs live
          ─► npm run test:production
schedule ─► production synthetic check every 30 min
```

Local is the source of truth: production is never edited by hand, and every deploy ends by
proving that the files serving traffic are byte-identical to the local release.
