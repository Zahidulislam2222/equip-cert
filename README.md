<div align="center">

# EquipCert AI

### AI-Powered Equipment Safety Inspection & Compliance Platform

[![Next.js](https://img.shields.io/badge/Next.js-16.1-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-Auth%20%2B%20DB-3FCF8E?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Flutter](https://img.shields.io/badge/Flutter-Android%20%2B%20iOS-02569B?style=flat-square&logo=flutter&logoColor=white)](https://flutter.dev/)
[![Stripe](https://img.shields.io/badge/Stripe-Payments-635BFF?style=flat-square&logo=stripe&logoColor=white)](https://stripe.com/)
[![License](https://img.shields.io/badge/License-Proprietary-red?style=flat-square)](#license)

**Identify equipment with AI. Run safety checklists. Produce signed inspection records built around OSHA 29 CFR 1910.157 and NFPA 10. All from your phone.**

[Built to scale](#built-to-scale) &nbsp;&middot;&nbsp; [Architecture](#architecture) &nbsp;&middot;&nbsp; [Security](SECURITY.md) &nbsp;&middot;&nbsp; [Getting Started](#getting-started)

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
| **Digital Signatures** | ESIGN Act-compliant electronic signatures with full audit trail |
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
| **Industrial Dark Theme** | Dark-first design with ANSI safety colors + Framer Motion animations across all pages. Light mode toggle available |
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
 │  /api/stripe │  │  Storage         │
 │              │  │  Realtime        │
 │  AI Provider │  │                  │
 │  Abstraction │  │  8 tables        │
 └──────────────┘  └──────────────────┘
```

> **Key constraint:** `output: "export"` in Next.js config — a static site the edge can cache. This means no middleware, no server components, no API routes in the app directory. All auth is client-side. API endpoints are standalone Vercel serverless functions.

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Framework | **Next.js 16** + React 19 | Static export + file-based routing |
| Language | **TypeScript 5** | Type safety across the entire codebase |
| Styling | **Tailwind CSS 3.4** | Utility-first with custom "Industrial Dark" design system — ANSI safety colors, blueprint grids |
| UI | **Radix UI** + CVA | Accessible, composable components |
| Auth | **Supabase Auth** | Email, magic link, OAuth — with RLS for data isolation |
| Database | **Supabase PostgreSQL** | 8 tables, Row Level Security, realtime subscriptions |
| AI | **Gemini / OpenAI / Claude** | Abstracted provider — swap via env var |
| Payments | **Stripe** | Subscriptions, webhooks, customer portal |
| Mobile | **Flutter** | Native Android + iOS client with camera, GPS and offline queue |
| CMS | **Contentful** | Dynamic equipment checklists managed by non-developers |
| PDF | **react-pdf/renderer** | Server-quality inspection reports in the browser |
| Offline | **IndexedDB** | Queue submissions offline, auto-sync on reconnect |
| Animations | **Framer Motion 12** | 9 motion primitives: scroll reveals, staggered grids, spring physics, parallax, kinetic text, AnimatePresence transitions |
| Toasts | **Sonner** | Non-intrusive notifications |
| Charts | **Recharts** | Dashboard analytics (ready for Phase 3 expansion) |

---

## Database Schema

```
organizations ─┬── profiles (role-based: admin / manager / technician)
               ├── equipment (registry with status + due dates)
               ├── inspections (photos, GPS, signatures, audit trail)
               │   └── corrective_actions (severity, assignment, resolution)
               ├── schedules (recurring per equipment)
               ├── notifications (realtime via Supabase)
               └── audit_log (append-only, written by database triggers)
```

All tables enforce **Row Level Security** — users only see data from their organization. Signed inspection records are **immutable** (database trigger prevents modification after signature).

---

## Compliance

| Standard | Implementation |
|----------|---------------|
| **OSHA 29 CFR 1910.157(e)(3) / NFPA 10** | Inspector, date and findings on every record; server-generated timestamps; signed records immutable. Retention follows 1910.157(e)(3) — one year after the last entry or the life of the shell — not the "5 years" an earlier version of this README cited from an unrelated rule |
| **ESIGN / UETA / eIDAS Art. 25(1)** | Affirmative consent before signing, attribution to the signed-in user, immutable signed records |
| **GDPR** | Record of processing, sub-processor list, breach procedure, data subject request intake with statutory deadlines, erasure that separates the person from the safety record (`docs/compliance/`) |
| **US state privacy (CCPA/CPRA and others)** | Consent with equal-prominence reject, Global Privacy Control honoured, rights request intake |
| **EU AI Act Art. 50** | AI-derived results disclosed before signing; provenance stamped server-side; PDF reports marked machine-readably ([classification memo](docs/compliance/ai-act-classification.md)) |

Not claimed: SOC 2 or any other certification, and legal review — the policies contain
placeholders for the operator's legal identity and have not been reviewed by counsel.

### Security Hardening

| Protection | Implementation |
|-----------|---------------|
| **API Authentication** | JWT verification on `/api/analyze` — unauthenticated requests rejected |
| **Input Validation** | Zod schema on all API inputs — type, size, and format enforced |
| **Rate Limiting** | Per IP and per account on the AI and privacy-request endpoints, shared across replicas when a store is configured |
| **RLS (Row Level Security)** | Every table scoped to organization and FORCEd; cross-tenant isolation proven by an e2e suite |
| **Audit Log** | Changes to inspections, roles, plans, equipment and privacy requests written by triggers; clients cannot write or edit it |
| **Server Hardening** | Header/request/keep-alive timeouts, bounded bodies, graceful drain, non-root read-only container |
| **Feature Gating (DB-level)** | PostgreSQL trigger enforces free plan limits — cannot bypass via DevTools |
| **Immutable Records** | Signed inspections cannot be UPDATE'd or DELETE'd (trigger) |
| **Security Headers** | CSP, HSTS, COOP, CORP, frame-ancestors none — one source for Vercel and self-host. Vulnerability reporting: [SECURITY.md](SECURITY.md) |
| **Open Redirect Prevention** | Notification URLs validated (`startsWith('/')` only) |
| **Offline Integrity** | SHA-256 hash on queued submissions — tampered data rejected on sync |
| **Secret Protection** | `.env*`, `*.key`, `*.keystore`, `.claude/` all gitignored |

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
└── docs/                         # SCALING, AVAILABILITY, compliance records
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

| Competitor | Price | EquipCert Advantage |
|-----------|-------|-------------------|
| SafetyCulture | $24-29/user/mo | AI equipment identification, multi-provider AI, lower entry price |
| Field1st | Custom | Open architecture, not locked to one AI vendor |
| GoAudits | Custom | Full offline mode with auto-sync, GPS evidence |
| SmartQHSE | Custom | Simpler UX, faster onboarding, mobile-first |

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

## Contributing

This is a proprietary project. For inquiries about partnerships or enterprise licensing, please reach out.

---

## License

Proprietary. All rights reserved.

---

<div align="center">

**Built with** &nbsp; Next.js &middot; React &middot; Supabase &middot; Tailwind &middot; Flutter &middot; Stripe

</div>
