# EquipCert AI — Build Guide for Claude Code Agents

## Quick Start for New Sessions

1. Read the full plan: `.claude/plans/breezy-meandering-stonebraker.md`
2. Check build progress: memory file `project_build_status.md`
3. Resume from the first unchecked `[ ]` task

## Critical Constraints

- **`output: "export"`** in `next.config.ts` — static site for Capacitor mobile
- NO Next.js middleware, NO server components, NO API routes in app dir
- `api/analyze.ts` is a STANDALONE Vercel serverless function (not Next.js API route)
- All auth/routing is CLIENT-SIDE (Supabase Auth + React context guards)
- New API endpoints go in `/api/` folder as standalone Vercel functions

## Architecture

```
Static Export (Capacitor + Vercel)
├── /(marketing)  — Landing, Pricing, Privacy, Terms (public)
├── /(auth)       — Login, Signup (public)
└── /(app)        — Protected app shell (client-side auth guard)
    ├── Dashboard, Inspections, Equipment, Schedule
    ├── Team, Reports, Settings
    └── Inspect (technician flow)

Vercel Serverless: api/analyze.ts, api/webhooks/stripe.ts
Supabase: Auth + PostgreSQL + Storage + RLS + Realtime
```

## Rules

- **ZERO HARDCODING**: All config via env vars → `app/lib/config.ts`
- AI models configured via `AI_PROVIDER` + `AI_MODEL_NAME` env vars
- AI provider abstraction in `app/lib/ai/provider.ts` (Gemini/OpenAI/Claude)
- All DB tables must have `organization_id` + RLS policies
- Signed inspection records are IMMUTABLE (RLS prevents UPDATE/DELETE)
- Timestamps are server-generated (`DEFAULT now()`)
- Update `project_build_status.md` memory file after completing each phase task

## Tech Stack

- Next.js 16 (static export) + React 19 + TypeScript 5
- Supabase (Auth + DB + Storage + Realtime)
- Capacitor 8 (Android mobile)
- Contentful CMS (equipment checklists)
- AI: Google Gemini + OpenAI + Anthropic (abstracted)
- Stripe (payments)
- TailwindCSS + Framer Motion + Recharts + Sonner

## Design System — "Industrial Premium"

- Primary: `hsl(210 100% 45%)` Deep Industrial Blue
- Accent: `hsl(28 100% 55%)` Safety Orange
- Success: `hsl(152 69% 40%)` Equipment Green
- Display font: Plus Jakarta Sans / Body: Inter
- 3-tier shadows: sm, card, elevated
- Dark mode support

## Commands

```bash
npm run dev      # Dev server
npm run build    # Production build (static export)
npm run lint     # ESLint
```
