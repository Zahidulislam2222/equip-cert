# Security model

What EquipCert AI protects, from whom, how, and where the protection is known to be weaker than
it should be. To **report** a vulnerability, use [SECURITY.md](../SECURITY.md), not this file.

**Reviewed:** 2026-09-24. **Certification:** none claimed — not SOC 2, not ISO 27001. This
document is the engineering basis such an audit would start from.

---

## 1. What is being protected

| Asset | Why it matters | Worst outcome |
|---|---|---|
| Inspection records | Legal evidence under OSHA 1910.157 and NFPA 10 | A record altered after signature, so it no longer proves what happened |
| Evidence photos and signatures | Personal data; a signature is identity | Served to the internet — a notifiable GDPR breach |
| Tenant boundary | Every customer's data shares one database | One organisation reads or writes another's records |
| Accounts and roles | A manager or admin can change others' access | A technician promotes themself, or joins another tenant |
| AI and email quotas | Paid or rate-capped upstream services | One caller exhausts them for everyone |
| Secrets | Service-role key bypasses row-level security | A client bundle or APK carrying it |

## 2. Trust boundaries

```
 untrusted                         │ partly trusted              │ trusted
───────────────────────────────────┼─────────────────────────────┼────────────────────────────
 browser / phone / network         │ origin: api/*, server.ts    │ Postgres: RLS, triggers,
 anything in a request body        │ sees JWTs, calls AI provider │ SECURITY DEFINER functions
 the device clock, GPS, filenames  │ never holds the service key  │ holds the authorization rules
                                   │ in a client-reachable path   │
```

The rule that follows: **nothing the client sends is authority.** Organisation IDs, roles,
timestamps and file paths are derived server-side or checked by the database, never taken from
the request.

## 3. Threats and controls (STRIDE)

| Threat | Example | Control | Evidence |
|---|---|---|---|
| **Spoofing** | Calling the AI endpoint without an account | Fail-closed JWT verification in `/api/analyze`; missing auth configuration is an error, not a pass | `api/analyze.ts` |
| Spoofing | Credential stuffing on sign-in | Supabase Auth rate limits; client-side breached-password check (k-anonymity, the password never leaves the device) | `src/lib/password-safety.ts`; CAPTCHA **not yet on** — §5 |
| **Tampering** | Editing a signed inspection | Trigger rejects `UPDATE`/`DELETE` on signed rows; the only permitted change is the exact shape GDPR erasure needs | `app.prevent_signed_inspection_change()` |
| Tampering | Altering a queued offline submission | SHA-256 over canonical JSON; mismatches are rejected at sync | `src/lib/offline.ts`, `mobile/test/offline_integrity_test.dart` |
| Tampering | Back-dating a record | Timestamps are `DEFAULT now()` in the database, never the device clock | `supabase/migrations/` |
| **Repudiation** | "I never signed that" | Explicit consent to sign electronically (web; the mobile app shows a notice only — DEF-067); signature bound to the signed-in account; append-only audit log written by triggers (built and e2e-tested; not yet applied to the hosted database) | `e2e/audit-log.test.mjs` |
| **Information disclosure** | Reading another tenant's rows (OWASP API1, BOLA) | Row-level security on all 11 tables, `FORCE`d on the 10 holding tenant data, every client policy `TO authenticated`; cross-tenant e2e suite against a real Postgres | `e2e/rls-isolation.test.mjs` |
| Information disclosure | Guessing an evidence photo URL | Private bucket, tenant-scoped path, unguessable name, short-lived signed URLs, MIME allow-list | `supabase/migrations/*_storage.sql` |
| Information disclosure | Service-role key in a client | One configuration owner; `NEXT_PUBLIC_` and `--dart-define` values are scanned by the build gate; the key never reaches `mobile/` | `scripts/check-config-boundary.mjs` |
| Information disclosure | Session token theft on a phone | Refresh token in platform secure storage, never plain preferences | `mobile/test/secure_session_storage_test.dart` |
| Information disclosure | Cleartext traffic from the app | Release manifest and Info.plist checked in CI **after** the build, because merged library manifests can reintroduce it | `.github/workflows/ci.yml` |
| **Denial of service** | Draining the AI quota | Per-IP and per-account limits, keys hashed, shared across replicas, never fail open | `src/lib/rate-limit.ts`, `unit/rate-limit.test.mjs` |
| Denial of service | Slowloris / slow headers | Header, request and keep-alive timeouts; checking interval derived from them (a real defect fixed — Node's 30 s default made a 15 s timeout 15–45 s) | [AVAILABILITY.md](AVAILABILITY.md) §2.2 |
| Denial of service | Oversized uploads and bodies | Bounded request bodies; client-side downscale; storage size cap | `deploy/server.ts`, `src/lib/capture.ts` |
| **Elevation of privilege** | Technician sets their own role to admin | Column-level trigger guards on role and tenant changes | `app.guard_profile_privileges()` |
| Elevation of privilege | Filing a privacy request into another tenant's queue | The request endpoint never reads `organization_id` from the body | `api/dsar.ts` |
| Elevation of privilege | Bypassing plan limits from DevTools | Limits enforced by a database trigger generated from `plans.ts` | `npm run test:schema` |

## 4. Browser and transport

| Header | Value (summary) | Why |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'`; `object-src 'none'`; `frame-ancestors 'none'`; `connect-src` lists every origin the app may contact | Each third party must be named to be reachable — the CSP doubles as a data-flow inventory |
| `Strict-Transport-Security` | one year, subdomains | No downgrade to HTTP |
| `Cross-Origin-Opener-Policy` / `-Resource-Policy` | `same-origin` | Cross-origin isolation of windows and resources |
| `Permissions-Policy` | camera and geolocation `self` only, microphone off | The two sensors the product needs, nothing else |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | No paths leak to third parties |

The same headers ship on both deployment targets: they are written once in `vercel.json` and the
self-host proxy configuration is **generated** from it.

**Known weakness:** `script-src` keeps `'unsafe-inline'`. A static export cannot issue per-request
nonces, which is what removing it requires. `'unsafe-eval'` has been removed. This is a
consequence of decision D1 in [ARCHITECTURE.md](ARCHITECTURE.md), stated rather than hidden.

## 5. Known gaps

Recorded in `supabase/auth-baseline.json` under `known_gaps`, and summarised here so a reviewer
does not report them as discoveries:

| Gap | Impact | Path to close |
|---|---|---|
| CAPTCHA off | Credential stuffing is only rate limited | Needs a Turnstile/hCaptcha key, the mobile client sending tokens first, and the widget on the sign-in pages |
| No absolute session lifetime on the free plan | A stolen refresh token stays valid until rotation catches it or the user signs out | Paid database plan feature |
| Breached-password check is advisory | It runs on the client, so it warns rather than enforces | Server-side check on a paid plan |
| Shared auth email sender | Capped at a few messages per hour; password resets stop under load | Custom SMTP (free to configure, needs a provider credential) |
| Two public services without a DPA (geocoding receives coordinates; the breached-password check receives a hash prefix) | Documented, but not yet in the privacy policy; the geocoder also has a usage-policy ceiling | Self-hosted or contracted geocoder — [ROADMAP.md](ROADMAP.md) |
| No web client unit or integration suite | Web regressions are caught by build, lint and e2e only | Roadmap item |
| No third-party penetration test | Controls are self-verified | Roadmap item, before the first enterprise customer |

## 6. Assurance in the pipeline

| Layer | What runs |
|---|---|
| Before commit | gitleaks, bandit, semgrep (`.pre-commit-config.yaml`) |
| Pushes to `main` and pull requests | configuration-boundary gate, lint, type check, build, unit tests, manifest drift, Flutter analyze and tests, built-artifact hardening checks |
| Live gates | tenant-isolation e2e, migrations applied, generated types match, Supabase security and performance advisors |
| Security workflow | gitleaks and semgrep on pushes to `main` and every pull request |
| Dependencies | Dependabot for npm and GitHub Actions |
| Production | synthetic check every 30 minutes: health, readiness, headers, and that the backend compiled into the shipped bundle is the intended one — built; activates with this push and will report failure until the hosted database is restored |

## 7. Incident history

Real issues found and fixed in this codebase — kept visible because how they were found says more
than a clean record would:

- **Public evidence bucket.** Photos and signatures were once served from a public bucket under
  timestamp filenames. Replaced with a private, tenant-scoped, signed-URL design.
- **Wrong backend in a shipped bundle.** The site answered 200 while its compiled-in database no
  longer existed. Led to the production check that inspects the shipped bundle, not just the port.
- **Slow-header timeout not enforced.** Found by a behavioural test in the production image, not
  by reading code.
- **Rate-limit key without expiry.** A non-atomic sequence could leave a key with no TTL and a
  permanent 429. Repaired, with unit tests for the race.
- **Undisclosed third-party recipients.** Found by comparing the CSP with the sub-processor list: a geocoder and the breached-password API were reachable but unlisted.
