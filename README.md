<div align="center">

# EquipCert AI

### AI-Powered Equipment Safety Inspection & Compliance Platform

[![Next.js](https://img.shields.io/badge/Next.js-16.3-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-Auth%20%2B%20DB-3FCF8E?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Flutter](https://img.shields.io/badge/Flutter-Android%20%2B%20iOS-02569B?style=flat-square&logo=flutter&logoColor=white)](https://flutter.dev/)
[![Stripe](https://img.shields.io/badge/Stripe-Payments-635BFF?style=flat-square&logo=stripe&logoColor=white)](https://stripe.com/)
[![License](https://img.shields.io/badge/License-Proprietary-red?style=flat-square)](LICENSE)
[![CI](https://github.com/Zahidulislam2222/equip-cert/actions/workflows/ci.yml/badge.svg)](https://github.com/Zahidulislam2222/equip-cert/actions/workflows/ci.yml)

**Identify equipment with AI. Run safety checklists. Produce signed inspection records built around OSHA 29 CFR 1910.157 and NFPA 10. All from your phone.**

**[Live site](https://equipcert.zahidul-islam.com)**¹ &nbsp;&middot;&nbsp; [Documentation](docs/README.md) &nbsp;&middot;&nbsp; [Roadmap](docs/ROADMAP.md) &nbsp;&middot;&nbsp; [Built to scale](#built-to-scale) &nbsp;&middot;&nbsp; [Legal map](docs/compliance/README.md) &nbsp;&middot;&nbsp; [Security](docs/SECURITY-MODEL.md) &nbsp;&middot;&nbsp; [Getting Started](#getting-started)

¹ *Status 2026-09-24: the site is up, but the hosted database it is built against is offline, so sign-in does not work until it is restored. See [ROADMAP.md](docs/ROADMAP.md) Phase 1.*

---

</div>

## The Problem

Field equipment inspections still rely on paper checklists, manual data entry, and filing cabinets. This leads to:

- Records that are incomplete, illegible or missing when an auditor asks for them
- Hours wasted identifying equipment and finding the right checklist
- No real-time visibility into fleet compliance
- Corrective actions lost in email threads
- Zero proof that inspections actually happened on-site

## The Solution

EquipCert AI replaces the entire paper workflow with a mobile-first platform. A technician points their phone camera at any equipment — AI identifies it, loads the correct safety checklist, captures GPS-tagged evidence, and produces a signed, immutable inspection record and PDF report. The technician reviews and signs every AI suggestion; the model never decides.

Managers get a real-time dashboard showing fleet compliance, failed items requiring attention, and corrective action tracking.

---

## Features

### For Technicians

| Feature | Description |
|---------|-------------|
| **AI Equipment ID** | Point camera at equipment — AI identifies type, serial number, and visible safety issues |
| **Smart Checklists** | Dynamic questions loaded from CMS based on equipment type |
| **GPS Evidence** | Automatic location capture proving the technician was on-site |
| **Digital Signatures** | Built to the ESIGN / UETA elements: consent to sign electronically (an explicit control on web; a notice on mobile, control planned), attribution to the signed-in user, immutable record |
| **Offline Mode** | Complete inspections without connectivity — auto-syncs when back online |
| **Photo Evidence** | Capture and attach photographic evidence to any inspection |

### For Managers

| Feature | Description |
|---------|-------------|
| **Live Dashboard** | Real-time stats — total inspections, failure rate, safety score |
| **Corrective Actions** | Track failed items through open → in-progress → resolved workflow |
| **Equipment Registry** | Full fleet inventory with inspection history and due-date tracking |
| **Inspection Scheduling** | Recurring schedules (daily/weekly/monthly/quarterly) with overdue alerts |
| **PDF Reports** | Downloadable inspection reports, machine-readably marked when AI-assisted (EU AI Act Art. 50) |
| **Team Management** | Role-based access control — admin, manager, technician |
| **Real-time Notifications** | Instant alerts for failures, overdue actions, and upcoming inspections |

### Platform

| Feature | Description |
|---------|-------------|
| **Multi-AI Provider** | Swap between Gemini, OpenAI, or Claude via environment variable — zero code changes |
| **Multi-Tenant** | Organization-scoped data isolation with Row Level Security |
| **Dark-first design** | Warm near-black surfaces, one Safety Yellow accent, Archivo + Inter; semantic colour pairs contrast-tested against WCAG. Light mode available |
| **Mobile App** | Native Flutter client for Android and iOS (`mobile/`), sharing the backend, schema and compliance contracts |
| **Plan Tiers** | Free / Pro / Enterprise limits enforced by a database trigger. Stripe checkout is integrated but not configured |

---

## Built to scale

The architecture is designed so that going from one container to tens of thousands of concurrent
users is **configuration and provisioning, not a rewrite**. What is measured, what is built, and
what is only designed-for are labelled separately — the current deployment is a single container
on a free-tier database and claims none of the large numbers.

| Property | Where | Status |
|---|---|---|
| Static export served from the edge — most traffic never reaches an origin | `next.config.ts`, cache headers | Built |
| Stateless origin: N replicas behind a `least_conn` pool with `/readyz` health checks | `deploy/deploy.config.json` → `npm run deploy:gen` | Built, `caddy validate` OK |
| Kubernetes: rolling updates with `maxUnavailable: 0`, HPA 3→50, PodDisruptionBudget, NetworkPolicy, non-root read-only pods | `deploy/k8s/` | Built, kubeconform valid, drift-checked in CI |
| Graceful drain: readiness fails before the listener closes, hard deadline after — zero-downtime rolling deploys **at ≥ 2 replicas** (the current VPS runs 1, so a restart there still drops requests) | `deploy/server.ts` | Drain sequence **verified** 13/13 in the production image; zero-downtime not yet measured |
| Rate limits shared across replicas, keys hashed, never fail open | `src/lib/rate-limit.ts` | Built, unit tested |
| Tenant isolation enforced by Postgres RLS, so more replicas cannot weaken it | `supabase/migrations/` | Verified by e2e suite |
| Read replica routing with the user's JWT, config-gated | `src/lib/supabase.ts` | Built; no replica provisioned |
| Capacity test with SLO thresholds: smoke / 10k / 100k / 1M profiles | `load/k6/capacity-plan.js` | Built, `k6 inspect` valid, not yet run at scale |
| Origin throughput, one process | `npm run test:load` | **Measured**: ~3,600 req/s, 0 failures at 300 concurrent |
| Continuous production check: health, readiness, headers, compiled backend | `.github/workflows/production-check.yml` | Built |

- **[docs/SCALING.md](docs/SCALING.md)** — the capacity model for 10k / 100k / 1M concurrent, the arithmetic, the order things break in, and the cost ladder.
- **[docs/AVAILABILITY.md](docs/AVAILABILITY.md)** — SLOs per tier (99.9 % / 99.95 %), error budgets, failure modes, RPO/RTO and runbooks.
- **[docs/ROADMAP.md](docs/ROADMAP.md)** — the phases from today to 1M+ concurrent users, each ending in a measured exit criterion rather than a date.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│        Static Export (Vercel or self-host + Flutter)     │
│                                                         │
│  Landing ─── Auth ─── Protected App Shell               │
│   /           /auth    /app                              │
│   /privacy             ├── dashboard                    │
│   /terms               ├── inspections                  │
│                        ├── equipment                    │
│                        ├── schedule                     │
│                        ├── team / reports / settings    │
│                        └── inspect (technician flow)    │
│                                                         │
│  Client-side auth guards (no middleware — static export)│
└────────────────┬────────────────────────────────────────┘
                 │
        ┌────────┴────────┐
        ▼                 ▼
 ┌──────────────┐  ┌──────────────────┐
 │   Vercel     │  │    Supabase      │
 │  Serverless  │  │                  │
 │              │  │  Auth            │
 │  /api/analyze│  │  PostgreSQL + RLS│
 │  /api/dsar   │  │  Storage         │
 │  /api/       │  │  Realtime        │
 │  webhooks/   │  │                  │
 │  stripe      │  │                  │
 │  AI Provider │  │                  │
 │  Abstraction │  │  11 tables       │
 └──────────────┘  └──────────────────┘
```

> **Key constraint:** `output: "export"` in Next.js config — a static site the edge can cache. This means no middleware, no server components, no API routes in the app directory. All auth is client-side and the database enforces authorization. API endpoints are standalone serverless handlers that run on Vercel or behind the self-host adapter.
>
> The component map, data flows and the reasoning behind each decision are in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Framework | **Next.js 16** + React 19 | Static export + file-based routing |
| Language | **TypeScript 5** | Type safety across the entire codebase |
| Styling | **Tailwind CSS 3.4** | Design tokens owned by `src/app/globals.css` — dark-first, Safety Yellow accent |
| UI | **Radix Slot** + CVA | Composable component variants |
| Auth | **Supabase Auth** | Email, magic link, OAuth — with RLS for data isolation |
| Database | **Supabase PostgreSQL** (EU) | 11 tables, Row Level Security, triggers, realtime subscriptions |
| AI | **Gemini / OpenAI / Claude** | Abstracted provider — swap via env var |
| Payments | **Stripe** | Checkout and webhooks built; not configured yet |
| Mobile | **Flutter** | Native Android + iOS client with camera, GPS and offline queue |
| CMS | **Contentful** | Dynamic equipment checklists managed by non-developers |
| PDF | **react-pdf/renderer** | Server-quality inspection reports in the browser |
| Offline | **IndexedDB** | Queue submissions offline, auto-sync on reconnect |
| Animations | **Framer Motion 12** | 9 motion primitives: scroll reveals, staggered grids, spring physics, parallax, kinetic text, AnimatePresence transitions |
| Toasts | **Sonner** | Non-intrusive notifications |
| Charts | **Recharts** | Dashboard analytics |
| 3D / film | **Three.js** + Blender | Landing hero: a rendered inspection film and an interactive model, with a text-first fallback |

---

## Database Schema

```
organizations ─┬── profiles (role-based: admin / manager / technician)
               ├── equipment (registry with status + due dates)
               ├── inspections (photos, GPS, signatures, audit trail)
               │   └── corrective_actions (severity, assignment, resolution)
               ├── schedules (recurring per equipment)
               ├── notifications (realtime via Supabase)
               ├── consent_records (what was agreed to, against which policy version)
               ├── data_subject_requests (privacy requests with statutory deadlines)
               └── audit_log (append-only; trigger-written once the latest migration is applied to the hosted database)
plan_limits (generated from src/lib/plans.ts)
```

**Row Level Security** is enabled on all 11 tables and forced on the 10 holding tenant data — users only see data from their organization. Signed inspection records are **immutable** (database trigger prevents modification after signature).

---

## Compliance

| Standard | Implementation |
|----------|---------------|
| **OSHA 29 CFR 1910.157(e)(3) / NFPA 10** | Inspector, date and findings on every record; server-generated timestamps; signed records immutable. Retention follows 1910.157(e)(3) — one year after the last entry or the life of the shell — not the "5 years" an earlier version of this README cited from an unrelated rule |
| **ESIGN / UETA / eIDAS Art. 25(1)** | Affirmative consent before signing, attribution to the signed-in user, immutable signed records |
| **GDPR** | Record of processing, sub-processor list, breach procedure, data subject request intake with statutory deadlines, erasure that separates the person from the safety record (`docs/compliance/`) |
| **US state privacy (CCPA/CPRA and others)** | Consent with equal-prominence reject, Global Privacy Control honoured, rights request intake |
| **EU AI Act Art. 50** | AI-derived results disclosed before signing; provenance stamped server-side; PDF reports marked machine-readably ([classification memo](docs/compliance/ai-act-classification.md)) |

The full map — including the Cyber Resilience Act, NIS2, the ADA and the European Accessibility Act, with what applies, what is done and what is open — is in **[docs/compliance/README.md](docs/compliance/README.md)**.

Not claimed: SOC 2 or any other certification, and legal review — the policies contain
placeholders for the operator's legal identity and have not been reviewed by counsel.

### Security Hardening

| Protection | Implementation |
|-----------|---------------|
| **API Authentication** | JWT verification on `/api/analyze` — unauthenticated requests rejected |
| **Input Validation** | Zod schema on all API inputs — type, size, and format enforced |
| **Rate Limiting** | Per IP and per account on the AI endpoint, per IP on the privacy-request endpoint, shared across replicas when a store is configured |
| **RLS (Row Level Security)** | Every tenant table scoped to organization and FORCEd; cross-tenant isolation proven by an e2e suite |
| **Audit Log** | Changes to inspections, roles, plans, equipment and privacy requests written by triggers; clients cannot write or edit it — built and e2e-tested, not yet applied to the hosted database |
| **Server Hardening** | Header/request/keep-alive timeouts, bounded bodies, graceful drain, non-root read-only container |
| **Feature Gating (DB-level)** | PostgreSQL trigger enforces free plan limits — cannot bypass via DevTools |
| **Immutable Records** | Signed inspections cannot be UPDATE'd or DELETE'd (trigger) |
| **Security Headers** | CSP, HSTS, COOP, CORP, frame-ancestors none — one source for Vercel and self-host. Vulnerability reporting: [SECURITY.md](SECURITY.md) |
| **Open Redirect Prevention** | Notification URLs validated (`startsWith('/')` only) |
| **Offline Integrity** | SHA-256 hash on queued submissions — tampered data rejected on sync |
| **Secret Protection** | One configuration owner enforced by the build; `.env*`, keys and keystores gitignored; gitleaks before commit and in CI |

Threat model, trust boundaries and known gaps: **[docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md)**. Accessibility: **[docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md)**.

---

## Getting Started

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com/) project
- A [Contentful](https://www.contentful.com/) space (for checklists)
- An AI API key (Google, OpenAI, or Anthropic)

### Setup

```bash
# Clone
git clone https://github.com/Zahidulislam2222/equip-cert.git
cd equip-cert

# Install dependencies
npm install

# Configure environment
cp .env.example .env.local
# Edit .env.local with your keys

# Apply the database migrations (supabase/migrations/, applied in filename order)
npx supabase db push

# Start dev server
npm run dev
```

Never point the e2e suite (`npm run test:rls`) at a project holding real customer data — run it
against a local stack (`npx supabase start`).

### Environment Variables

```env
# AI — swap provider anytime, zero code changes
AI_PROVIDER=google                    # google | openai | anthropic
AI_MODEL_NAME=gemini-2.5-flash       # any model from chosen provider
AI_API_KEY=your-key

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...

# Contentful
NEXT_PUBLIC_CONTENTFUL_SPACE_ID=...
NEXT_PUBLIC_CONTENTFUL_ACCESS_TOKEN=...

# Stripe
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_...
STRIPE_SECRET_KEY=sk_...
```

See [`.env.example`](.env.example) for the full list.

---

## Project Structure

```
equip-cert/
├── api/                          # Standalone serverless handlers (Vercel or the self-host adapter)
│   ├── analyze.ts                #   AI image analysis — auth, rate limits, provider-abstracted
│   ├── dsar.ts                   #   Privacy / data subject request intake
│   └── webhooks/stripe.ts        #   Stripe webhooks
├── src/
│   ├── app/                      # Static-export routes: landing, auth, /app, privacy, terms
│   ├── components/               # auth, dashboard, technician, corrective, shared
│   ├── content/                  # Policy and terms copy — single owner, rendered by pages
│   └── lib/
│       ├── config.ts             #   The ONLY reader of process.env (enforced by test:config)
│       ├── plans.ts              #   The ONLY owner of prices and plan limits
│       ├── supabase.ts           #   Primary + read-replica clients
│       ├── rate-limit.ts         #   Memory and shared Redis-REST limiters
│       ├── pdf-provenance.ts     #   AI Act Art. 50 report marking
│       └── ai/                   #   Provider factory (Gemini / OpenAI / Claude)
├── mobile/                       # Flutter Android + iOS client
├── supabase/migrations/          # Schema, RLS, triggers, audit log
├── deploy/                       # Self-host server, Dockerfile, config, generated k8s manifests
├── load/k6/                      # Capacity plan with SLO thresholds
├── e2e/ · unit/                  # Database authorization suite · unit tests
└── docs/                         # Architecture, scaling, availability, roadmap, security, accessibility, compliance
```

---

## Pricing Model

Free, Pro and Enterprise tiers. Prices, limits and feature lists live in exactly one place,
[`src/lib/plans.ts`](src/lib/plans.ts), and the landing page and the database limit trigger are
generated from it — so they are deliberately not restated here, where they would drift.

---

## Deployment

### Web

Two targets from one build, with the same security headers (derived from `vercel.json`):

- **Vercel** — static export plus the `api/` handlers.
- **Self-host** — `deploy/server.ts` in a non-root container behind Caddy. `npm run deploy:gen -- --release <id>`
  generates the Caddy site file, `compose.yaml` and the Kubernetes manifests from
  `deploy/deploy.config.json`. Never hand-edit the generated files.

`NEXT_PUBLIC_*` values are compiled into the bundle: build with the production app URL and the
production Supabase project, then run `npm run test:production` against the deployment.

### Mobile

CI builds and verifies the Flutter Android release and compiles iOS on macOS. See `mobile/README.md`.

### Database

`npx supabase db push` applies `supabase/migrations/` in order. `npm run test:migrations` and
`npm run test:types` confirm the live schema matches the repository.

---

## Competitors & Positioning

| Competitor | EquipCert AI's intended difference |
|-----------|-------------------|
| SafetyCulture | AI equipment identification, multi-provider AI |
| Field1st | Open architecture, not locked to one AI vendor |
| GoAudits | Full offline mode with auto-sync, GPS evidence |
| SmartQHSE | Simpler UX, faster onboarding, mobile-first |

Competitor pricing changes often and is deliberately not quoted here; check each vendor's site.

**Our differentiator:** AI-powered equipment identification + multi-provider AI abstraction + compliance built into the data model (OSHA/NFPA record-keeping, e-signature, GDPR and US state privacy, EU AI Act disclosure) — in a mobile-first platform that works offline.

---

## Commands

```bash
npm run dev              # Development server
npm run build            # Static export (includes the configuration-boundary gate)
npm run build:server     # Bundle the self-host server
npm test                 # Config boundary, schema, deploy-manifest drift, unit tests
npm run lint             # ESLint
npm run test:rls         # Database authorization + audit log e2e (local stack only)
npm run test:load        # Origin throughput harness
npm run test:production  # Check a deployment: health, readiness, headers, compiled backend
```

---

## Documentation

| Document | Covers |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | Components, data model, flows, decisions and why |
| [Scaling](docs/SCALING.md) | 10k / 100k / 1M concurrent — the arithmetic and the ladder |
| [Availability](docs/AVAILABILITY.md) | Uptime targets, error budgets, failure modes, runbooks |
| [Roadmap](docs/ROADMAP.md) | From today to 1M+ users, with exit criteria |
| [Security model](docs/SECURITY-MODEL.md) | Threats, controls, known gaps |
| [Legal map](docs/compliance/README.md) | US and EU law — what applies and what is done |
| [Accessibility](docs/ACCESSIBILITY.md) | WCAG 2.1 AA target and status |
| [Mobile client](mobile/README.md) | Flutter Android + iOS |
| [Changelog](CHANGELOG.md) | What changed, and when |

---

## Contributing

Issues are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and the gates every change passes. Security reports go through [SECURITY.md](SECURITY.md), never a public issue.

---

## License

Proprietary, source published for review — see [LICENSE](LICENSE).

---

<div align="center">

**Built with** &nbsp; Next.js &middot; React &middot; Supabase &middot; Tailwind &middot; Flutter &middot; Stripe

</div>
