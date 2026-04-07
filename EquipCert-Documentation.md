# EquipCert AI — Complete Project Documentation

## Overview

**EquipCert AI** is a production-grade, AI-powered equipment safety inspection and compliance SaaS platform. It enables technicians to conduct field inspections using AI-powered equipment identification, dynamic safety checklists, GPS-tagged evidence, and ESIGN-compliant digital signatures — all from a mobile phone or desktop browser.

**Repository:** https://github.com/Zahidulislam2222/equip-cert
**Live URL:** Deployed on Vercel
**Mobile App:** Android via Capacitor (APK built via GitHub Actions)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 16.1, React 19, TypeScript 5 |
| **Styling** | TailwindCSS 3.4, Plus Jakarta Sans + Inter fonts |
| **UI Components** | Radix UI, CVA (Class Variance Authority), Lucide Icons |
| **Animations** | Framer Motion, TailwindCSS Animate, CSS Keyframes |
| **State** | TanStack React Query, React Context |
| **Auth** | Supabase Auth (email/password, magic link, OAuth) |
| **Database** | Supabase PostgreSQL with Row Level Security |
| **Storage** | Supabase Storage (photos, signatures) |
| **Realtime** | Supabase Realtime (notifications) |
| **CMS** | Contentful (equipment checklists) |
| **AI** | Google Gemini, OpenAI, Anthropic Claude (abstracted, env-var driven) |
| **Payments** | Stripe (subscriptions, webhooks) |
| **Mobile** | Capacitor 8 (Android, camera, GPS) |
| **PDF** | react-pdf/renderer |
| **Offline** | IndexedDB queue with auto-sync |
| **Deploy** | Vercel (web), GitHub Actions (APK) |
| **Notifications** | Sonner (toasts), Supabase Realtime (in-app) |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                Static Export (Capacitor + Vercel)            │
│                                                             │
│  /                Landing Page (public marketing)           │
│  /privacy         Privacy Policy (CCPA)                     │
│  /terms           Terms of Service (ESIGN)                  │
│  /auth/login      Login (email, magic link, OAuth)          │
│  /auth/signup     Signup (create org + profile)             │
│  /app/dashboard   Manager dashboard (stats, inspections)    │
│  /app/inspections Inspections list                          │
│  /app/equipment   Equipment registry (CRUD, QR)             │
│  /app/schedule    Inspection scheduling                     │
│  /app/team        Team management                           │
│  /app/reports     Analytics & reports                       │
│  /app/settings    Org settings, theme toggle                │
│  /app/inspect     Technician inspection flow                │
│                                                             │
│  Client-side auth guard (Supabase Auth, no middleware)       │
│  Static export constraint: output: "export"                 │
└──────────────┬──────────────────────────────────────────────┘
               │
       ┌───────┴───────┐
       ▼               ▼
┌──────────────┐  ┌─────────────────┐
│ Vercel       │  │ Supabase        │
│ Serverless   │  │                 │
│              │  │ Auth            │
│ /api/analyze │  │ PostgreSQL + RLS│
│ /api/webhooks│  │ Storage         │
│   /stripe    │  │ Realtime        │
│              │  │ Edge Functions  │
│ AI Provider  │  │                 │
│ Abstraction  │  │ 8 tables        │
└──────────────┘  └─────────────────┘
```

### Critical Constraint
`next.config.ts` uses `output: "export"` for Capacitor mobile builds. This means:
- NO Next.js middleware
- NO server components
- NO API routes in the app directory
- All auth/routing is CLIENT-SIDE
- API endpoints are standalone Vercel serverless functions in `/api/`

---

## Database Schema

### Tables (8 total, all with RLS)

| Table | Purpose |
|-------|---------|
| `organizations` | Multi-tenant orgs (name, slug, plan, Stripe IDs) |
| `profiles` | Users linked to auth.users (name, role, org_id, qualifications, ESIGN consent) |
| `equipment` | Equipment registry (name, serial, status, location, next_due_date) |
| `inspections` | Inspection records (equipment, inspector, checklist, photo, GPS, signature, audit trail) |
| `corrective_actions` | Failed item tracking (severity, assignment, due date, resolution) |
| `schedules` | Recurring inspections (frequency, next_due, equipment, assignee) |
| `notifications` | In-app alerts (type, title, body, is_read, realtime subscription) |
| `audit_log` | All write operations logged (user, action, resource, timestamp) |

### Security
- **Row Level Security (RLS)** on ALL tables — org-scoped isolation
- **Signed inspection immutability** — trigger prevents UPDATE/DELETE on records with signatures
- **Server-generated timestamps** — `DEFAULT now()`, cannot be backdated

---

## Features

### Authentication & Authorization
- Email/password signup and login
- Magic link (passwordless) login
- OAuth ready (Google, Microsoft)
- Role-based access: admin, manager, technician
- Organization-scoped data isolation
- Client-side route guards (ProtectedRoute component)
- Session management via Supabase Auth

### AI Equipment Identification
- **3 providers supported**: Google Gemini, OpenAI, Anthropic Claude
- **Zero hardcoding**: Provider and model set via `AI_PROVIDER` + `AI_MODEL_NAME` env vars
- **Factory pattern**: `createAIProvider()` returns unified interface
- Identifies: equipment name, serial number, safety status, visible issues
- Shared prompt template across all providers

### Inspection Flow (Technician)
- **Manual mode**: Select equipment, run predefined checklist
- **AI mode**: Take photo → AI identifies equipment → loads correct checklist from Contentful
- Pass/fail each checklist item
- Failed items trigger corrective action form (severity, description, photo)
- GPS location captured automatically
- Digital signature before submission
- Submission saved to Supabase with full audit trail
- Offline queue if no connectivity

### Manager Dashboard
- Real-time stats (total inspections, failed items, safety score) — queried from Supabase
- Recent inspections table with search, photo view, PDF download
- Corrective actions sidebar with status filters and resolution tracking
- Notification bell with Supabase Realtime subscription

### Equipment Registry
- Full CRUD: add, view, search equipment
- Fields: name, type, serial number, location, status, photo
- Status tracking: active, out of service, retired
- Next inspection due date with countdown
- Card-based responsive grid layout

### Corrective Actions
- Triggered on checklist fail with severity (critical/major/minor)
- Description + photo evidence
- Manager assignment and due dates
- Status workflow: open → in_progress → resolved
- Filterable list view

### Inspection Scheduling
- Per-equipment recurring schedules (daily/weekly/monthly/quarterly/annually)
- Due date tracking with overdue alerts
- Schedule list with color-coded urgency

### Notifications
- In-app notification bell with unread count badge
- Supabase Realtime subscription — instant delivery
- Types: inspection_due, corrective_assigned, corrective_overdue, inspection_failed, system
- Mark as read, mark all read

### Digital Signatures (ESIGN Act Compliant)
- `react-signature-canvas` integration
- Captures: signature image, signer identity, timestamp, device info
- ESIGN Act notice displayed before signing
- Signed records are immutable (database trigger prevents modification)
- Signature stored in Supabase Storage

### GPS Location Evidence
- Capacitor Geolocation (native) with browser fallback
- Reverse geocoding via Nominatim (free, OpenStreetMap)
- Coordinates + readable address stored with inspection

### PDF Reports
- Professional inspection reports via react-pdf/renderer
- Contains: equipment ID, inspector, date, checklist results, photo evidence
- Downloadable from manager dashboard

### Offline Mode
- IndexedDB-based submission queue
- Checklist template caching
- Auto-sync when connectivity restored
- Visual offline indicator with queue count
- Toast notifications on sync status

### Dark Mode
- Light / Dark / System toggle
- All CSS variables have dark mode counterparts
- Persisted in localStorage
- System preference detection via `prefers-color-scheme`

---

## Design System — "Industrial Premium"

### Colors
| Token | Value | Usage |
|-------|-------|-------|
| Primary | `hsl(210 100% 45%)` | Deep Industrial Blue — authority, trust |
| Accent | `hsl(28 100% 55%)` | Safety Orange — CTAs, urgency |
| Success | `hsl(152 69% 40%)` | Equipment Green — safe status |
| Warning | `hsl(45 93% 52%)` | Caution Yellow — attention needed |
| Destructive | `hsl(0 72% 51%)` | Alert Red — critical failures |

### Typography
- **Display font**: Plus Jakarta Sans (headings)
- **Body font**: Inter (readable body text)

### Elevation
- `shadow-sm`: subtle (cards at rest)
- `shadow-card`: medium (interactive cards)
- `shadow-elevated`: prominent (modals, dropdowns)
- `shadow-industrial`: branded blue glow
- `shadow-glow`: primary color glow on hover

### Animations
- fade-in, fade-in-up, slide-in-right, slide-in-left, scale-in
- pulse-glow (primary CTA buttons)
- shimmer (skeleton loading)
- float (hero decorative elements)

---

## Legal Compliance

### OSHA (29 CFR 1926)
- All required fields enforced: equipment ID, inspector, datetime, findings, corrective actions
- Server-generated timestamps (tamper-proof)
- Competent person qualification tracking
- Equipment out-of-service enforcement on critical failures
- 5+ year retention design
- Digital records: 96% audit pass rate vs 73% paper

### ESIGN Act (15 U.S.C. §7001)
- Electronic signature consent capture
- Signature attribution: user ID + timestamp + device info
- Immutable signed records (database trigger)
- Clear intent: explicit "sign and submit" action

### CCPA/CPRA 2026
- Privacy policy page with all required disclosures
- Terms of service page
- Cookie consent banner with granular controls
- Global Privacy Control (GPC) signal honored automatically
- Data categories disclosed
- Data export and deletion rights documented

### Security
- Row Level Security on all tables
- CSP headers via vercel.json (X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
- Permissions-Policy (camera, geolocation restricted to self)
- Organization-scoped data isolation
- Audit logging on mutations

---

## Pricing Model (Stripe)

| Plan | Price | Limits |
|------|-------|--------|
| **Free** | $0 forever | 1 user, 10 inspections/mo, 5 AI analyses/mo, basic PDFs |
| **Pro** | $29/user/mo | Unlimited inspections + AI, corrective actions, signatures, scheduling, priority support |
| **Enterprise** | $79/user/mo | Everything in Pro + SSO/SAML, API access, custom branding, multi-site analytics, dedicated support |

14-day free trial of Pro included.

---

## Project Structure

```
equip-cert/
├── api/                              # Vercel serverless functions
│   ├── analyze.ts                    # AI image analysis endpoint
│   └── webhooks/
│       └── stripe.ts                 # Stripe webhook handler
├── app/
│   ├── page.tsx                      # Landing page (marketing)
│   ├── layout.tsx                    # Root layout (AuthProvider, Toaster, CookieConsent, OfflineIndicator)
│   ├── globals.css                   # Design system (Industrial Premium palette, dark mode, animations)
│   ├── privacy/page.tsx              # Privacy policy
│   ├── terms/page.tsx                # Terms of service
│   ├── auth/
│   │   ├── login/page.tsx            # Login (split-screen)
│   │   └── signup/page.tsx           # Signup (create org)
│   ├── app/
│   │   ├── layout.tsx                # Authenticated shell (ProtectedRoute + AppLayout)
│   │   ├── dashboard/page.tsx        # Manager dashboard
│   │   ├── inspections/page.tsx      # Inspections list
│   │   ├── equipment/page.tsx        # Equipment registry CRUD
│   │   ├── schedule/page.tsx         # Inspection scheduling
│   │   ├── team/page.tsx             # Team management
│   │   ├── reports/page.tsx          # Analytics
│   │   ├── settings/page.tsx         # Org settings + theme toggle
│   │   └── inspect/page.tsx          # Technician inspection flow
│   ├── components/
│   │   ├── auth/
│   │   │   ├── AuthProvider.tsx       # Auth context + session management
│   │   │   └── ProtectedRoute.tsx     # Client-side route guard
│   │   ├── layout/
│   │   │   └── AppLayout.tsx          # Sidebar + topbar + notification bell
│   │   ├── dashboard/
│   │   │   ├── StatsCards.tsx         # Real Supabase aggregation stats
│   │   │   ├── InspectionsTable.tsx   # Inspection list with PDF download
│   │   │   ├── InspectionReportPDF.tsx # PDF report layout
│   │   │   ├── ManagerDashboard.tsx   # Legacy manager view
│   │   │   └── ManagerSidebar.tsx     # Legacy sidebar
│   │   ├── technician/
│   │   │   ├── TechnicianFlow.tsx     # View state manager
│   │   │   ├── TechnicianHome.tsx     # Mode selector (manual/AI) + real stats
│   │   │   └── InspectionScreen.tsx   # Main inspection UI
│   │   ├── corrective/
│   │   │   ├── CorrectiveActionForm.tsx  # Issue report modal
│   │   │   └── CorrectiveActionList.tsx  # Action tracker with filters
│   │   ├── equipment/
│   │   │   └── EquipmentCard.tsx      # Equipment display card
│   │   ├── shared/
│   │   │   ├── NotificationBell.tsx   # Realtime notification center
│   │   │   ├── SignaturePad.tsx       # ESIGN-compliant signature capture
│   │   │   ├── GPSCapture.tsx         # Location evidence capture
│   │   │   ├── OfflineIndicator.tsx   # Connectivity status + sync
│   │   │   ├── ThemeToggle.tsx        # Light/dark/system toggle
│   │   │   └── CookieConsent.tsx      # CCPA cookie banner with GPC
│   │   └── ui/
│   │       ├── button.tsx             # CVA button component
│   │       └── badge.tsx              # Status badge component
│   ├── hooks/
│   │   └── use-mobile.ts             # Responsive detection
│   └── lib/
│       ├── config.ts                  # Central env-var config (zero hardcoding)
│       ├── supabase.ts                # Supabase client
│       ├── contentful.ts              # Contentful CMS client
│       ├── auth.ts                    # Auth helpers (signUp, signIn, signOut, OAuth)
│       ├── stripe.ts                  # Stripe loader, plan definitions, feature gating
│       ├── offline.ts                 # IndexedDB queue + cache + sync
│       ├── utils.ts                   # cn() utility
│       └── ai/
│           ├── provider.ts            # AI factory (createAIProvider)
│           ├── types.ts               # EquipmentAnalysis, AIProvider interfaces
│           ├── prompt.ts              # Shared analysis prompt
│           ├── google.ts              # Google Gemini implementation
│           ├── openai.ts              # OpenAI implementation
│           └── anthropic.ts           # Anthropic Claude implementation
├── supabase/
│   └── migrations/
│       └── 001_production_schema.sql  # Full schema (8 tables, RLS, triggers)
├── android/                           # Capacitor Android project
├── public/
│   └── manifest.json                  # PWA manifest
├── .env.example                       # All env vars documented
├── .gitignore                         # Secrets protected
├── vercel.json                        # CSP security headers
├── CLAUDE.md                          # Build guide for AI agents
├── next.config.ts                     # Static export config
├── tailwind.config.ts                 # Design system tokens
├── capacitor.config.ts                # Mobile app config
├── package.json                       # Dependencies
└── tsconfig.json                      # TypeScript config
```

---

## Environment Variables

| Variable | Where Used | Description |
|----------|-----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Client | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel only | Supabase admin key (webhooks) |
| `NEXT_PUBLIC_CONTENTFUL_SPACE_ID` | Client | Contentful space |
| `NEXT_PUBLIC_CONTENTFUL_ACCESS_TOKEN` | Client | Contentful token |
| `AI_PROVIDER` | Vercel only | google, openai, or anthropic |
| `AI_MODEL_NAME` | Vercel only | Model name for chosen provider |
| `AI_API_KEY` | Vercel only | API key for chosen provider |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Client | Stripe public key |
| `STRIPE_SECRET_KEY` | Vercel only | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Vercel only | Stripe webhook signing secret |
| `NEXT_PUBLIC_APP_NAME` | Client | App name (default: EquipCert AI) |
| `NEXT_PUBLIC_APP_URL` | Client | App URL |

---

## Deployment

### Web (Vercel)
1. Push to `main` branch — Vercel auto-deploys
2. Set all env vars in Vercel dashboard
3. Run SQL migration in Supabase SQL Editor

### Mobile (Android)
1. GitHub Actions builds APK on push to `main`
2. APK artifact available in Actions tab
3. Uses Capacitor 8 with static export

### Database Setup
1. Go to Supabase Dashboard → SQL Editor
2. Paste contents of `supabase/migrations/001_production_schema.sql`
3. Run — creates all 8 tables, indexes, RLS policies, and triggers

### Stripe Setup
1. Create products in Stripe matching plan IDs (free, pro, enterprise)
2. Set webhook endpoint: `https://your-domain.com/api/webhooks/stripe`
3. Subscribe to events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`

---

## Commands

```bash
npm run dev      # Start development server
npm run build    # Production build (static export)
npm run lint     # Run ESLint
npm run start    # Start production server
```

---

## Competitors Analyzed

| Competitor | Key Differentiator |
|-----------|-------------------|
| SafetyCulture (iAuditor) | 100K+ templates, $24-29/user/mo |
| Field1st | Real-time AI risk prediction |
| GoAudits | True offline, instant branded reports |
| SmartQHSE | 120+ modules, ISO 45001 |
| BasinCheck | Sub-60s audits, GPS evidence |
| Procore | Full construction suite |
| Fieldwire | Task management, plan markup |

**EquipCert differentiator:** AI-powered equipment identification + full compliance stack (OSHA + ESIGN + CCPA) + multi-AI-provider abstraction — all in a mobile-first, eye-catching design.
