# Security policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub's private vulnerability reporting:
<https://github.com/Zahidulislam2222/equip-cert/security/advisories/new>

Include what you found, how to reproduce it, and what an attacker could do with it. A proof of
concept that stays inside your own test account is ideal.

What to expect:

| Step | Target |
|---|---|
| Acknowledgement | within 3 business days |
| Initial assessment and severity | within 7 days |
| Fix or mitigation for a critical or high finding | as fast as it can be done safely; you will be kept informed |
| Public disclosure | coordinated with you, after a fix is available |

These are good-faith targets for a small project, not a contractual SLA.

## Safe harbour

Research that follows this policy is authorised and will not be treated as a breach of the Terms
of Service. In return:

- Test only against accounts and organisations you created yourself.
- Do not access, modify or keep data belonging to anyone else. If you reach it by accident, stop,
  do not keep a copy, and tell us what you saw.
- Do not degrade the service for others: no denial-of-service, no load testing against production,
  no spam, no social engineering of users or staff.
- Give us a reasonable chance to fix the issue before you disclose it.

## Supported versions

Only the current `main` branch and the release running at <https://equipcert.zahidul-islam.com>
are supported; fixes are not backported. The Flutter client is not published in an app store, so
the supported mobile build is the one built from `main`.

Status as of 2026-11-25: no third-party penetration test has been performed, and the product holds
no security certification. The controls below are tested by this repository's own suites, listed
in [CONTRIBUTING.md](CONTRIBUTING.md#gates).

## Scope

In scope:

- The web application and its API handlers (`api/`), the self-host adapter (`deploy/`), and the
  Flutter client (`mobile/`). The handlers are:
  - `/api/analyze` — AI photo analysis.
  - `/api/assist` — the in-app help assistant, which reads a summary of the caller's own
    organisation with the caller's session.
  - `/api/billing/checkout`, `/api/billing/portal`, `/api/billing/seats` — subscription
    changes, the billing portal and seat-count sync.
  - `/api/webhooks/stripe` — Stripe events that change an organisation's plan.
  - `/api/dsar` — data subject request intake.

  Billing is built and wired to Stripe, but live payments are not enabled: no live keys are
  configured and nobody is charged. A finding that would let someone change their plan, seats
  or billing identifiers without a verified Stripe event is still in scope.
- Invitations: creating, revoking and accepting an invitation link (`/auth/signup#invite=…`,
  `/auth/login#invite=…`, and the `accept_invite` database function). Joining an organisation
  you were not invited to, choosing your own role, or reusing an expired, revoked or accepted
  link are all in scope.
- E-signature consent: filing a signed inspection without the signer's recorded consent, or
  recording consent for someone else.
- The database schema and its row-level security, storage policies and triggers
  (`supabase/migrations/`) — tenant isolation failures are the most valuable class of report.
- The deployment configuration generated from this repository (security headers, proxy, container
  hardening, Kubernetes manifests).

Out of scope:

- Findings in third-party services themselves (Supabase, the AI providers, Cloudflare, Stripe) —
  report those to the vendor.
- Missing hardening headers on third-party domains, clickjacking on pages with no state-changing
  action, self-XSS, and reports from automated scanners with no shown impact.
- Rate-limit bypass that requires rotating IP addresses at scale (documented, and the limit is
  per-account after authentication).

## How this codebase defends itself

A short map for reviewers, so a report can say which control failed:

| Layer | Control | Where |
|---|---|---|
| Tenant isolation | Row-level security enabled on all 13 tables and `FORCE`d on the 12 holding tenant or billing data (`plan_limits` is a shared read-only price table); cross-tenant e2e suite and a local-stack tenancy suite | `supabase/migrations/`, `e2e/rls-isolation.test.mjs`, `e2e/local/tenancy.test.mjs` |
| Account provisioning | A new organisation and its admin are created in one server-side transaction; no client policy can insert a profile into an existing tenant | `public.provision_account()` in `supabase/migrations/20261125000100_tenancy_invites_consent.sql` |
| Invitations | Only an admin can invite or revoke; the invitee never chooses their role and cannot be made admin; single use, time-limited (1–720 hours), revocable; only a SHA-256 of the 192-bit token is stored; the plan's seat limit is checked under a row lock | `public.organization_invites`, `public.accept_invite()` (same migration) |
| Privilege escalation | Column-level trigger guards on role and tenant changes | `app.guard_profile_privileges()` |
| Evidence integrity | Signed inspections immutable; erasure permitted only in one exact shape | `app.prevent_signed_inspection_change()` |
| E-signature consent | A signed inspection is refused unless it is filed by the inspector who signed it and that person has recorded consent with the wording version; the server stamps the time; consent cannot be recorded for someone else. Enforced on insert and on update of the signature | `app.require_consenting_signer()`, `public.record_esign_consent()`, `supabase/migrations/20261125000200_sign_via_update.sql` |
| Billing | Plan and billing identifiers change only through verified billing events; webhook signatures verified on the raw body; checkout and portal are admin-only; seat count is read from the database, never the request; a live Stripe key is refused unless explicitly allowed by configuration | `app.guard_organization_billing()`, `api/webhooks/stripe.ts`, `api/billing/`, `src/lib/billing.ts` |
| Help assistant | Signed-in members only; reads with the caller's session so RLS decides what it sees; performs no actions and stores no conversation; bounded input and output, per-user and per-IP rate limits; free models only | `api/assist.ts`, `src/lib/assist/core.ts` |
| Accountability | Append-only audit log written by database triggers; clients cannot write it. Live on the hosted database since 2026-10-01 and e2e-tested there | `supabase/migrations/20260914000100_audit_log_writes.sql`, `e2e/audit-log.test.mjs` |
| API auth | Fail-closed JWT verification on every authenticated handler; per-account and per-IP rate limits, shared across replicas when configured | `api/analyze.ts`, `src/lib/server-auth.ts`, `src/lib/server-rate-limit.ts`, `src/lib/rate-limit.ts` |
| Secrets | One configuration boundary, enforced in CI; service-role key never reaches a client | `src/lib/config.ts`, `scripts/check-config-boundary.mjs` |
| Transport and browser | HSTS, CSP, COOP, CORP, frame-ancestors none — one source for every target | `vercel.json`, `scripts/gen-deploy-artifacts.mjs` |
| Runtime | Non-root, read-only filesystem, all capabilities dropped, request timeouts, bounded bodies | `deploy/Dockerfile`, `deploy/server.ts`, `deploy/k8s/` |
| Supply chain | gitleaks and semgrep in CI; gitleaks, bandit and semgrep before each commit; Dependabot updates for npm and Actions; pinned base image digest | `.github/workflows/security.yml`, `.pre-commit-config.yaml`, `.github/dependabot.yml` |
| Auth posture | Supabase Auth settings as code, drift-checked | `supabase/auth-baseline.json` |

Known, recorded gaps — so they are not reported as discoveries — are listed under `known_gaps` in
`supabase/auth-baseline.json`.
