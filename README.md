<div align="center">

# EquipCert AI

### AI-Powered Equipment Safety Inspection & Compliance Platform

[![Next.js](https://img.shields.io/badge/Next.js-16.1-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-Auth%20%2B%20DB-3FCF8E?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Capacitor](https://img.shields.io/badge/Capacitor-8-119EFF?style=flat-square&logo=capacitor&logoColor=white)](https://capacitorjs.com/)
[![Stripe](https://img.shields.io/badge/Stripe-Payments-635BFF?style=flat-square&logo=stripe&logoColor=white)](https://stripe.com/)
[![License](https://img.shields.io/badge/License-Proprietary-red?style=flat-square)](#license)

**Identify equipment with AI. Run safety checklists. Generate OSHA-compliant reports. All from your phone.**

[Live Demo](#) &nbsp;&middot;&nbsp; [Documentation](#architecture) &nbsp;&middot;&nbsp; [Getting Started](#getting-started)

---

</div>

## The Problem

Field equipment inspections still rely on paper checklists, manual data entry, and filing cabinets. This leads to:

- **73% audit failure rate** with paper-based records (vs 96% with digital)
- Hours wasted identifying equipment and finding the right checklist
- No real-time visibility into fleet compliance
- Corrective actions lost in email threads
- Zero proof that inspections actually happened on-site

## The Solution

EquipCert AI replaces the entire paper workflow with a mobile-first platform. A technician points their phone camera at any equipment — AI identifies it, loads the correct safety checklist, captures GPS-tagged evidence, and generates a signed, OSHA-compliant report in seconds.

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
| **PDF Reports** | Downloadable OSHA-compliant inspection reports |
| **Team Management** | Role-based access control — admin, manager, technician |
| **Real-time Notifications** | Instant alerts for failures, overdue actions, and upcoming inspections |

### Platform

| Feature | Description |
|---------|-------------|
| **Multi-AI Provider** | Swap between Gemini, OpenAI, or Claude via environment variable — zero code changes |
| **Multi-Tenant** | Organization-scoped data isolation with Row Level Security |
| **Dark Mode** | System-aware theme with manual toggle |
| **Mobile App** | Android APK via Capacitor — same codebase |
| **Stripe Billing** | Free / Pro / Enterprise tiers with feature gating |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│              Static Export (Vercel + Capacitor)          │
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

> **Key constraint:** `output: "export"` in Next.js config for Capacitor mobile compatibility. This means no middleware, no server components, no API routes in the app directory. All auth is client-side. API endpoints are standalone Vercel serverless functions.

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Framework | **Next.js 16** + React 19 | Static export + file-based routing |
| Language | **TypeScript 5** | Type safety across the entire codebase |
| Styling | **Tailwind CSS 3.4** | Utility-first with custom "Industrial Premium" design system |
| UI | **Radix UI** + CVA | Accessible, composable components |
| Auth | **Supabase Auth** | Email, magic link, OAuth — with RLS for data isolation |
| Database | **Supabase PostgreSQL** | 8 tables, Row Level Security, realtime subscriptions |
| AI | **Gemini / OpenAI / Claude** | Abstracted provider — swap via env var |
| Payments | **Stripe** | Subscriptions, webhooks, customer portal |
| Mobile | **Capacitor 8** | Native camera, GPS, offline — one codebase |
| CMS | **Contentful** | Dynamic equipment checklists managed by non-developers |
| PDF | **react-pdf/renderer** | Server-quality inspection reports in the browser |
| Offline | **IndexedDB** | Queue submissions offline, auto-sync on reconnect |
| Animations | **Framer Motion** + CSS | Page transitions, skeleton loading, micro-interactions |
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
               └── audit_log (immutable write log)
```

All tables enforce **Row Level Security** — users only see data from their organization. Signed inspection records are **immutable** (database trigger prevents modification after signature).

---

## Compliance

| Standard | Implementation |
|----------|---------------|
| **OSHA 29 CFR 1926** | All required fields enforced, server-generated timestamps, competent person tracking, 5-year retention design |
| **ESIGN Act** | Electronic signature consent, attribution (user + timestamp + device), immutable signed records |
| **CCPA/CPRA 2026** | Privacy policy, terms of service, cookie consent with GPC signal support, data categories disclosed |
| **SOC 2 Ready** | RBAC, encryption, audit logging, org-scoped isolation — designed for future certification |

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

# Run database migration
# Paste supabase/migrations/001_production_schema.sql in Supabase SQL Editor

# Start dev server
npm run dev
```

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
├── api/                          # Vercel serverless functions
│   ├── analyze.ts                #   AI image analysis (provider-abstracted)
│   └── webhooks/stripe.ts        #   Stripe subscription webhooks
├── app/
│   ├── page.tsx                  # Marketing landing page
│   ├── auth/                     # Login + Signup (split-screen UI)
│   ├── app/                      # Protected app (16 routes)
│   │   ├── dashboard/            #   Manager dashboard + corrective actions
│   │   ├── equipment/            #   Equipment registry CRUD
│   │   ├── inspect/              #   Technician inspection flow
│   │   └── ...                   #   schedule, team, reports, settings
│   ├── components/
│   │   ├── auth/                 #   AuthProvider, ProtectedRoute
│   │   ├── layout/               #   AppLayout (sidebar + topbar)
│   │   ├── shared/               #   GPS, Signatures, Notifications, Offline
│   │   └── ...                   #   dashboard, technician, equipment, corrective
│   └── lib/
│       ├── ai/                   #   Provider factory (Gemini/OpenAI/Claude)
│       ├── config.ts             #   Central env-var config
│       ├── auth.ts               #   Auth helpers
│       ├── stripe.ts             #   Plans + feature gating
│       └── offline.ts            #   IndexedDB queue + sync
├── supabase/migrations/          # SQL schema (8 tables, RLS, triggers)
└── android/                      # Capacitor Android project
```

---

## Pricing Model

| | Free | Pro | Enterprise |
|---|---|---|---|
| **Price** | $0 | $29/user/mo | $79/user/mo |
| Users | 1 | Unlimited | Unlimited |
| Inspections | 10/mo | Unlimited | Unlimited |
| AI Analyses | 5/mo | Unlimited | Unlimited |
| Corrective Actions | - | Yes | Yes |
| Digital Signatures | - | Yes | Yes |
| Scheduling | - | Yes | Yes |
| SSO / SAML | - | - | Yes |
| API Access | - | - | Yes |
| Custom Branding | - | - | Yes |

---

## Deployment

### Web (Vercel)

Push to `main` — Vercel auto-deploys. Set environment variables in the Vercel dashboard.

### Mobile (Android)

GitHub Actions automatically builds an APK on every push to `main`. Download from the Actions tab.

### Database

Run `supabase/migrations/001_production_schema.sql` in the Supabase SQL Editor. This creates all 8 tables, indexes, RLS policies, and the signed-record immutability trigger.

---

## Competitors & Positioning

| Competitor | Price | EquipCert Advantage |
|-----------|-------|-------------------|
| SafetyCulture | $24-29/user/mo | AI equipment identification, multi-provider AI, lower entry price |
| Field1st | Custom | Open architecture, not locked to one AI vendor |
| GoAudits | Custom | Full offline mode with auto-sync, GPS evidence |
| SmartQHSE | Custom | Simpler UX, faster onboarding, mobile-first |

**Our differentiator:** AI-powered equipment identification + multi-provider AI abstraction + full US compliance stack (OSHA + ESIGN + CCPA) — in a mobile-first platform that works offline.

---

## Commands

```bash
npm run dev      # Development server
npm run build    # Production build (static export)
npm run lint     # ESLint
npm run start    # Serve production build
```

---

## Contributing

This is a proprietary project. For inquiries about partnerships or enterprise licensing, please reach out.

---

## License

Proprietary. All rights reserved.

---

<div align="center">

**Built with** &nbsp; Next.js &middot; React &middot; Supabase &middot; Tailwind &middot; Capacitor &middot; Stripe

</div>
