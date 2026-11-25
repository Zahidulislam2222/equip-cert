# Testing and verification

How EquipCert AI is tested, what each suite proves, and the latest results. A result is listed
only if the command was run; the date and environment are given with it.

**Reviewed:** 2026-11-25. Latest full CI run: all five jobs passed on commit `6762f0a`
(GitHub Actions run 45613839373).

---

## 1. The layers

| Layer | Command | Runs where | What it proves |
|---|---|---|---|
| Configuration boundary | `npm run test:config` | Every build, CI | No environment value, model id, price or secret escapes its single owner; every CSP origin is a disclosed recipient |
| Plan limits | `npm run test:schema` | Every build, CI | The database limit trigger matches `src/lib/plans.ts` |
| Deployment manifests | `npm run test:deploy` | CI | Generated Caddy, Compose and Kubernetes files match `deploy/deploy.config.json` |
| Unit | `npm run test:unit` | CI (Linux), Windows | `src/lib` and the API handlers: rate limits, billing state, webhook raw body, checklists, consent, PDF provenance, password check, assistant guards |
| Lint and types | `npm run lint`, `tsc` | CI | Static correctness |
| Integration (local database) | `npm run test:local` | CI and locally, on a fresh local Supabase stack built from the migrations (the billing suite runs only where a Stripe `sk_test_` key is present, so it is skipped in CI) | Tenancy, invitations, seat limits, billing guard, e-sign consent rules, server timestamps — against real Postgres |
| Browser flows + accessibility | `npm run test:browser` | CI, Playwright, desktop and phone viewports | Sign-up with server-side provisioning; signed inspection with photo, GPS, checklist and consent; failed item → corrective action; offline queue and sync; invitations; member removal; reports and CSV export; help assistant; all **under the production Content-Security-Policy**, with axe accessibility scans on public pages and the phone layout |
| Tenant isolation (hosted) | `npm run test:rls` | CI live job | Cross-tenant reads and writes refused, privilege escalation refused, audit log written by triggers |
| Live schema | `test:migrations`, `test:types`, `test:advisors` | CI live job | Every migration applied, generated types match, Supabase security and performance advisors clean |
| RLS coverage | `test:rls-policies` | On demand (operator) | Row-level security enabled on every table and forced where tenant data lives |
| Mobile | `dart format` → `flutter analyze` → `flutter test` → release build | CI (Android on Linux, iOS on macOS) | Formatting, zero analyzer issues (infos included), unit and widget tests, hardened release manifest, unsigned-when-unconfigured guarantee |
| Assistant | `node scripts/eval-assistant.mjs` | On demand (calls live free models) | Answer quality, prompt-injection resistance, unknown answers, no safety rulings — [AI-ASSISTANT.md](AI-ASSISTANT.md) §2.6 |
| Production | `npm run test:production` | Scheduled every 30 min (GitHub may delay scheduled runs by hours) and after each deploy | Site, health, readiness, security headers, API method guard, and that the shipped bundle points at the intended backend |
| Recovery | `npm run drill:restore` | On demand | Live data restores into a database rebuilt from the migrations alone — [AVAILABILITY.md](AVAILABILITY.md) §4 |
| Throughput | `npm run test:load`, `load/k6/capacity-plan.js` | On demand | Origin throughput (measured); SLO-threshold capacity profiles for 10k / 100k / 1M (built, not yet run at scale) — [SCALING.md](SCALING.md) |

## 2. Latest results

| Suite | Result | When / where |
|---|---|---|
| Unit | 144 / 144 | 2026-11-25, Windows and CI Linux |
| Integration, local database | Tenancy and invitations 31 / 31; billing end to end 10 / 10 | 31 in CI and locally; billing locally only (needs a Stripe `sk_test_` key), 2026-11-25 |
| Browser flows + axe | 18 / 18 | 2026-11-25, local and CI |
| Tenant isolation, hosted database | 28 / 28 | 2026-11-25, CI live job |
| Migrations applied | 11 / 11 | 2026-11-25, hosted database |
| Flutter | format clean · `No issues found!` · 447 tests passing · release APK built | 2026-11-25, CI |
| Assistant evaluation | 12 / 12 | 2026-11-25 |
| Production check | passing | after release 2026-11-25 and on schedule |
| Restore drill | every live row restored, ≈ 68 s end to end | 2026-11-25, developer machine |
| Origin throughput, one process | ≈ 3,600 req/s, 0 failures at 300 concurrent | 2026-09-10, developer machine, loopback |

## 3. Rules the suites follow

- **Test the production configuration.** The browser suite injects the real `vercel.json` CSP.
  A signature upload that worked in development failed under the production policy; only a test
  with the real headers could see it.
- **Real database for authorization.** Row-level security is tested against Postgres, locally
  and on the hosted project — never inferred from a stand-in.
- **A test must be able to fail.** New tests are checked against the broken version of the
  feature before they are trusted.
- **Format before analyze** on Flutter: the analyzer's answer depends on where lines break.
- **The hosted isolation suite leaves one fixture organisation per run**, because it signs
  inspections and a signed inspection can never be deleted. That is the immutability rule working,
  so the suite reports it instead of weakening the rule.

## 4. Not yet covered

| Gap | Plan |
|---|---|
| Capacity at 10k / 100k / 1M concurrent users | k6 profiles are built; they need a provisioned staging tier — [ROADMAP.md](ROADMAP.md) |
| Multi-replica zero-downtime deploys | Drain sequence verified; zero downtime measured only once ≥ 2 replicas run |
| Third-party penetration test | Roadmap, before the first enterprise customer |
| Manual screen-reader pass across every route | Automated axe checks run; a full manual audit is on the roadmap — [ACCESSIBILITY.md](ACCESSIBILITY.md) |
| Further invitation-lifecycle and billing-webhook edge cases | Logged as follow-ups |
