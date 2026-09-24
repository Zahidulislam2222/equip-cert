# Roadmap

Where EquipCert AI is, and the path from here to 1M+ concurrent users at 99.95 % availability.

**Updated:** 2026-09-24.

**How to read this.** Each phase ends with **exit criteria**, not a date. A phase is done when
its criteria are *measured*, not when its code is written. Phases 3–5 are **design targets**:
much of the code for Phases 3 and 4 already exists and is validated (see [SCALING.md](SCALING.md)); Phase 5 is
not built. None of those tiers is provisioned, and no capacity or uptime figure is claimed for the current
deployment. Anything marked 💲 costs money and needs the owner's approval before it starts.

```
 Phase 0        Phase 1            Phase 2            Phase 3           Phase 4           Phase 5
 SHIPPED   ──►  PRODUCTION    ──►  MOBILE STORES ──►  TIER 1       ──►  TIER 2       ──►  1M+
                READINESS          + CRA              10k · 99.9 %      100k · 99.95 %    multi-region
```

---

## Phase 0 — Built ✅

In the repository, built and tested. "Built" is not "live": the items Phase 1 names are not yet running in production.

| Area | Delivered |
|---|---|
| Product | AI equipment identification, CMS-driven checklists, GPS and photo evidence, e-signature, immutable records, PDF reports, corrective actions, schedules, realtime notifications, roles |
| Clients | Next.js 16 static web app; Flutter Android + iOS client with offline queue (423 tests) |
| Data | 11-table schema, row-level security, trigger-written audit log (migration built, not yet applied to the hosted database), plan limits in the database, EU residency |
| Compliance | GDPR records and procedures, consent with equal-prominence reject, Global Privacy Control, privacy request intake, AI Act Art. 50 disclosure and PDF marking — [legal map](compliance/README.md) |
| Security | Threat model, hardened headers, private evidence storage, rate limits, secret boundary enforced in CI — [security model](SECURITY-MODEL.md) |
| Scale groundwork | Stateless origin, replica pool generator, Kubernetes manifests (HPA 3→50, PDB, NetworkPolicy), shared rate-limit store, read-replica routing, k6 capacity plan |
| Operations | CI on pushes to `main` and every pull request (web, Android, iOS, live database gates), security workflow, Dependabot, production synthetic check, self-hosted deployment with hash-verified parity |

## Phase 1 — Production readiness

Closes the gaps that matter before a paying customer, most of them owner actions rather than code.

| Item | Why |
|---|---|
| **Restore the hosted database the live site is built against** | Offline as of 2026-09-24 — the site loads but sign-in fails. Rebuild with the restored project's URL, then `npm run test:production` |
| Apply the audit-log migration to the hosted database | Built and e2e-tested locally; until it is applied, the hosted audit log is not trigger-written and subject erasure is not available there |
| Apply the auth configuration baseline (`npm run test:auth-config -- --apply`) | Auth settings are kept as code; the hosted project must match them |
| Custom SMTP for auth email | The shared sender allows a few messages per hour — password resets fail under any load |
| CAPTCHA on sign-in and sign-up, mobile first | The control that actually stops credential stuffing ([SECURITY-MODEL.md](SECURITY-MODEL.md) §5) |
| Counsel review of the privacy policy, terms and DPA; fill the operator's legal identity | Every legal document says "not reviewed by counsel" until this is done |
| Name the geocoding and breached-password services in the privacy policy (DEF-066) | Disclosed in the third-party list; the policy text still lags |
| Explicit consent-to-sign control in the mobile app (DEF-067) | The web client asks for it; the mobile client shows a notice only |
| Production check passing | The 30-minute check goes live with the 2026-09-24 push; it will report failure until the hosted database is restored |
| A web client test suite | The web app has build, lint and database e2e coverage but no unit or integration suite |
| CI check that every CSP `connect-src` origin appears in the sub-processor list | The gap that let DEF-066 through |
| Configure Stripe (test mode first) | Checkout and webhooks are built; not configured |
| One restore drill from a backup | Until one is run, every recovery-time figure is a target without evidence |

**Exit criteria:** every Phase 1 item closed; `npm run test:production` green for 30 days.

## Phase 2 — Mobile stores and the Cyber Resilience Act

| Item | Why |
|---|---|
| Google Play release with the project keystore, with an off-site backup | The keystore is the app's identity on Play and cannot be replaced |
| 💲 iOS signing (Apple Developer Program) and App Store release | CI proves iOS compiles; signing needs a paid account |
| SBOM generation in CI for both clients | Needed for CRA vulnerability handling |
| CRA reporting runbook — ENISA single reporting platform: 24 h early warning and 72 h notification; final report 14 days after a fix is available (exploited vulnerabilities) or one month after notification (severe incidents) | Reporting duties apply from 11 Sep 2026 once the app is on the EU market |
| Accessibility audit against WCAG 2.1 AA, remediation, public conformance statement | ADA Title II customers must meet WCAG 2.1 AA by 2027–2028 — [ACCESSIBILITY.md](ACCESSIBILITY.md) |

**Exit criteria:** both apps in their stores; SBOM published per release; runbook rehearsed once.

## Phase 3 — Tier 1: 10,000 concurrent users, 99.9 % availability target

Mostly configuration — the code is built ([SCALING.md](SCALING.md) §4, steps 1–4).

| Item | Status of the code | Cost |
|---|---|---|
| 3 origin replicas behind the health-checked pool (≥ 2 for zero-downtime deploys) | Built, `caddy validate` passes at N=3 | $0 on the existing host |
| Shared rate-limit store (`RATE_LIMIT_STORE=redis-rest`) | Built, unit tested | Free tiers exist |
| Database on a paid plan: more pooler and Realtime connections, daily backups | Tier-aware configuration built | 💲 |
| Read replica for dashboard aggregates | Client routing built, RLS preserved via the user's JWT | 💲 |
| Self-hosted or contracted reverse geocoder | Endpoint is already configuration | $0–💲 |
| 1-minute external uptime monitor | 30-minute check exists | Free tiers exist |
| Run the k6 `10k` profile against a staging environment | Script built and validated | Generator compute |

**Exit criteria:** k6 `10k` profile passes its SLO thresholds; 30 days at ≥ 99.9 % on the external
monitor. Only then does SCALING.md's 10k row change from *designed for* to *measured*.

## Phase 4 — Tier 2: 100,000 concurrent users, 99.95 % availability target

| Item | Status of the code | Cost |
|---|---|---|
| Kubernetes, multi-node: rolling updates with `maxUnavailable: 0`, HPA 3→50, PodDisruptionBudget, NetworkPolicy | Built, kubeconform-valid, drift-checked in CI | 💲 cluster |
| Larger database compute and more read replicas; connection budget reserved for writes | Replica routing built in Phase 3 | 💲 |
| Point-in-time recovery | — | 💲 add-on |
| Third-party penetration test | — | 💲 |
| SOC 2 Type I readiness: policies, access reviews, evidence collection | Most technical controls exist | 💲 audit |
| Run the k6 `100k` profile from distributed generators | Script built | Generator compute |

**Exit criteria:** `100k` profile passes; a restore drill meets the RPO/RTO in
[AVAILABILITY.md](AVAILABILITY.md) §4; pen-test findings closed.

## Phase 5 — 1M+ concurrent users

This is where scaling stops being configuration. The honest plan, and the prerequisite already in
place for each step:

| Item | Prerequisite already in place |
|---|---|
| **Tenant sharding** across multiple database projects, routed by organisation | Every table is keyed by `organization_id` |
| **Evidence photos on object storage with their own CDN** | Evidence is already in a private bucket behind signed URLs, decoupled from the rows |
| **Purpose-built realtime fan-out** instead of one database socket per open dashboard | Notifications are a separate table and channel |
| **Multi-region**: static edge everywhere, origins per region, database primary per shard region with EU data staying in the EU | Stateless origin; configuration-owned URLs |
| **Distributed k6 `1m` profile** | Script built; refuses remote targets without explicit opt-in |
| SOC 2 Type II, SSO / SAML, customer-managed data retention | Audit log and retention columns exist |

**Exit criteria:** `1m` profile passes with the environment named; multi-region failover
rehearsed. Until then, 1M+ is a design target and is described as one.

---

## Product ideas, not commitments

Asset tags (QR / NFC) for instant equipment lookup · more inspection standards beyond portable
extinguishers · integrations API for maintenance systems · multi-language UI · optional qualified
electronic signatures (eIDAS) for customers whose regulator requires them.
