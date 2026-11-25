# Changelog

Notable changes, newest first. Dates are commit dates. Full detail is in the Git history.

## 2026-11-25 — Public documentation refresh

- New: [API reference](docs/API.md), [AI in EquipCert](docs/AI-ASSISTANT.md) and
  [testing and verification](docs/TESTING.md).
- Architecture, security model, scaling, availability, roadmap, legal map, records of processing,
  mobile and contributor guides brought in line with the released product.
- Privacy policy now names the two public services without a processing agreement (reverse
  geocoding and the breached-password check), closing the wording half of DEF-066.

## 2026-11-25 — Teams, billing, help assistant and an end-to-end pass

- **Teams:** administrators invite people with single-use, expiring links (only a hash is
  stored); the plan's member limit is enforced by the database; members can be removed while the
  records they signed stay intact.
- **E-signature evidence:** consent to sign electronically is stored with its text version and the
  server's time; the database refuses a signature without it, on insert and on update.
- **Records:** inspection times can no longer be set by a client; inspections advance equipment due dates
  and schedules; failed items lead to corrective actions; extinguishers get the built-in NFPA 10
  checklist when the CMS has none.
- **Billing:** Stripe Checkout, customer portal and per-user seats. The verified webhook alone
  sets the plan, from the customer's whole subscription set. Live payments are switched on when
  live keys are enabled.
- **Help assistant** on web and mobile: disclosed as AI, answers from approved help articles and a
  read-only view of the user's own organisation, never acts, keeps no transcript.
- **Reports and Team pages** with CSV export guarded against spreadsheet formula injection.
- **Offline:** queued work is sent when the app reopens online; another person's queued
  submission is held, not filed under the current user.
- **Testing:** Playwright browser suite with axe accessibility checks under the production CSP;
  integration tests on a local database in CI; unit tests 104 → 144; Flutter tests 429 → 447.
- **Security and dependencies:** production audit cleared (Next.js 16.4.6, zod 4.6.7).
- **Recovery:** first restore drill — every live row restored into a database rebuilt from the
  migrations, ≈ 68 s.

## 2026-10-01 — Backend restored, audit log live

- Hosted database back online; daily keep-alive now runs a real database query (DEF-069).
- Trigger-written audit log and subject erasure applied to the hosted database.
- Stripe webhook verifies the exact raw bytes on both hosts (DEF-008); placeholder secrets count
  as unset (DEF-003).
- Mobile client asks for consent to sign electronically before the signature pad accepts input.
- CI check that every Content-Security-Policy origin is a disclosed recipient.
- One owner for the operational scripts' environment.

## 2026-09-24 — Public documentation

- Added a legal map covering OSHA, NFPA 10, ESIGN/UETA, eIDAS, GDPR, ePrivacy, US state privacy,
  the EU AI Act, the Cyber Resilience Act, NIS2, the ADA and the European Accessibility Act
  (`docs/compliance/README.md`).
- Added the architecture decisions, STRIDE threat model, roadmap to 1M+ users with exit
  criteria, accessibility statement, contributing guide, this changelog and a licence file.
- Disclosed two public third-party services — reverse geocoding (OpenStreetMap Nominatim) and the
  breached-password check (Pwned Passwords) — that were reachable in the CSP but missing from the
  sub-processor list.
- Corrected security and legal status claims: the trigger-written audit log and subject erasure are
  built and tested but not yet applied to the hosted database; explicit consent-to-sign is on the
  web client, while the mobile client shows a notice.
- Enabled GitHub private vulnerability reporting, the channel `SECURITY.md` points to.
- Corrected stale facts in the README: framework version, table count, design system, Stripe
  status, supply-chain tooling.

## 2026-09-15 — Legal, security and scale hardening

- **Legal:** Terms of Service rewritten as a content file; AI Act Art. 50(2) machine-readable
  marking on PDF reports; audit-log writes with personal-detail redaction and subject erasure;
  privacy wording that no longer overstates who can edit the audit log.
- **Security:** distributed rate-limit store with TTL repair; `security.txt`; `SECURITY.md`;
  cross-origin isolation headers; slow-header timeout actually enforced.
- **Scale:** liveness and readiness probes, graceful drain, replica pool generation, Kubernetes
  manifests (HPA, PDB, NetworkPolicy), k6 capacity plan, production synthetic check,
  `docs/SCALING.md` and `docs/AVAILABILITY.md`.
- Hero hotspot markers stay hidden until the 3D scene is ready.

## 2026-09-11 — Flutter mobile client and CI

- Native Flutter client for Android and iOS: camera capture, GPS, secure session storage, offline
  queue with integrity digests, AI disclosure before signing.
- Six semantic colour tokens relit to pass WCAG contrast, hue and saturation unchanged.
- CI: web, Android and iOS jobs plus live database gates, all green.

## 2026-09-10 — Backend rebuild and compliance

- Schema rebuilt as an applicable baseline in the EU region; two authentication holes closed.
- Evidence photos and signatures moved from a public bucket to private, tenant-scoped storage
  with signed URLs.
- Tenant isolation proven against a real database by an e2e suite.
- Consent rebuilt: equal-prominence reject, Global Privacy Control with visible confirmation,
  real withdrawal; nothing optional can load before consent.
- AI-assisted results disclosed and their provenance recorded.
- Privacy request intake with statutory deadlines; privacy policy corrected to cite the right rule.
- Production dependency vulnerabilities cleared (24 → 0); CSP hardened.
- Measured origin capacity; tier made a configuration value.
- Capacitor removed in favour of native Flutter clients.

## 2026-09-09 — Landing experience

- Source moved to `src/`; landing page rebuilt around a rendered inspection film with a
  text-first fallback.

## 2026-04 — Production SaaS baseline

- Full compliance stack, security audit fixes, dark theme and motion redesign, README.

## 2025-12 → 2026-01 — First build

- Initial product: manager and technician views, Vercel serverless functions, Android build
  workflow, database keep-alive.
