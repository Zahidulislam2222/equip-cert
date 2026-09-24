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

## Scope

In scope:

- The web application and its API handlers (`api/`), the self-host adapter (`deploy/`), and the
  Flutter client (`mobile/`).
- The database schema and its row-level security, storage policies and triggers
  (`supabase/migrations/`) — tenant isolation failures are the most valuable class of report.
- The deployment configuration generated from this repository (security headers, proxy, container
  hardening, Kubernetes manifests).

Out of scope:

- Findings in third-party services themselves (Supabase, the AI providers, Cloudflare, Stripe) —
  report those to the vendor.
- Missing hardening headers on third-party domains, clickjacking on pages with no state-changing
  action, self-XSS, and reports from automated scanners with no demonstrated impact.
- Rate-limit bypass that requires rotating IP addresses at scale (documented, and the limit is
  per-account after authentication).

## How this codebase defends itself

A short map for reviewers, so a report can say which control failed:

| Layer | Control | Where |
|---|---|---|
| Tenant isolation | Row-level security enabled on all 11 tables and `FORCE`d on the 10 holding tenant data (`plan_limits` is a shared read-only price table); cross-tenant e2e suite | `supabase/migrations/*_rls_policies.sql`, `e2e/rls-isolation.test.mjs` |
| Privilege escalation | Column-level trigger guards on role and tenant changes | `app.guard_profile_privileges()` |
| Evidence integrity | Signed inspections immutable; erasure permitted only in one exact shape | `app.prevent_signed_inspection_change()` |
| Accountability | Append-only audit log written by database triggers; clients cannot write it. **Built and e2e-tested locally; the migration is not yet applied to the hosted database**, where the earlier member-insert policy still applies | `supabase/migrations/20260914000100_audit_log_writes.sql`, `e2e/audit-log.test.mjs` |
| API auth | Fail-closed JWT verification; per-account and per-IP rate limits, shared across replicas when configured | `api/analyze.ts`, `src/lib/rate-limit.ts` |
| Secrets | One configuration boundary, enforced in CI; service-role key never reaches a client | `src/lib/config.ts`, `scripts/check-config-boundary.mjs` |
| Transport and browser | HSTS, CSP, COOP, CORP, frame-ancestors none — one source for every target | `vercel.json`, `scripts/gen-deploy-artifacts.mjs` |
| Runtime | Non-root, read-only filesystem, all capabilities dropped, request timeouts, bounded bodies | `deploy/Dockerfile`, `deploy/server.ts`, `deploy/k8s/` |
| Supply chain | gitleaks, bandit, semgrep, Dependabot updates for npm and Actions, pinned base image digest | `.github/workflows/security.yml`, `.pre-commit-config.yaml`, `.github/dependabot.yml` |
| Auth posture | Supabase Auth settings as code, drift-checked | `supabase/auth-baseline.json` |

Known, recorded gaps — so they are not reported as discoveries — are listed under `known_gaps` in
`supabase/auth-baseline.json`.
