# Contributing

EquipCert AI is proprietary software whose source is published for review (see [LICENSE](LICENSE)).
Issues are welcome — bug reports, accessibility problems, documentation errors. Pull requests
from outside the project are accepted only by prior arrangement.

**Security problems are never reported in a public issue.** Use [SECURITY.md](SECURITY.md).

---

## Development setup

See [README.md → Getting Started](README.md#getting-started) for the web client and
[mobile/README.md](mobile/README.md) for the Flutter client.

## Rules every change follows

1. **One owner per value.** Environment and provider configuration lives only in
   `src/lib/config.ts` — nothing else in the application reads `process.env`; operational
   scripts and e2e suites read it only through `scripts/lib/ops-env.mjs`. Plan prices and limits
   live only in `src/lib/plans.ts`. Deployment values live only in `deploy/deploy.config.json`.
   Mobile configuration lives only in `mobile/lib/src/config/app_config.dart`. The e-sign consent
   wording and the help assistant's copy live in `src/content/`; the Flutter client's copies are
   checked against them by contract tests. `npm run test:config` fails the build when a value
   escapes its owner.
2. **No secrets in the repository.** Not in code, tests, fixtures or docs. Tests use obviously
   fake values. `.env.example` holds names and placeholders only.
3. **Adding an environment variable** means updating `src/lib/config.ts` *and* `.env.example`.
4. **Every tenant table** carries `organization_id` and row-level security policies `TO authenticated`
   (`plan_limits` is the one shared, read-only table).
   Schema changes are new files in `supabase/migrations/`; an applied migration is never edited.
5. **Signed inspection records are immutable.** Do not add a code path that updates one. Signing
   rules (the signer is the inspector, has recorded e-sign consent, and is on a plan that
   includes signatures) are enforced by database triggers on both insert and update; keep them
   there rather than in a client.
6. **No hand-edited generated files.** `deploy/generated/` and `deploy/k8s/` come from
   `npm run deploy:gen`; CI fails if the manifests drift from their config.
7. **Claims need evidence.** Documentation says *measured*, *built* or *designed for*, and never
   blurs them.

## Gates

Run before opening a pull request. CI runs the same set and more.

### Web client and server handlers

```bash
npm run test:config      # configuration boundary (also runs inside npm run build)
npm run lint             # ESLint over src/ api/ deploy/
npm run test:unit        # node unit tests over src/lib and the API handlers
npm test                 # config, plan limits, deploy manifests, then the unit tests
npm run build            # type check + static export
npm run build:server     # self-host adapter
```

`npm run test:unit` ran **144 tests, all passing**, on 2026-11-25.

### Local Supabase stack and browser flows

Anything touching the schema, row-level security, invitations, billing or e-sign consent also
needs the local stack. Both suites refuse a Supabase URL that is not loopback, so they cannot
reach a hosted project. Neither calls an AI provider; the billing suite calls Stripe's API when a
`sk_test_` key is present in `.env.local` and is skipped otherwise (as it is in CI).

```bash
npx supabase start                         # applies every migration to an empty database
npm run test:local                         # tenancy, invitations, billing guard, e-sign consent
npx playwright install chromium            # once
npm run test:browser                       # Playwright + axe, desktop and phone viewports
```

`test:browser` overwrites `out/` with a build pointed at the local stack; rebuild before any
deployment.

`npm run test:rls` runs the cross-tenant isolation and audit-log suites against a real Supabase
project. It leaves one fixture organisation behind per run, because a signed inspection can never
be deleted — never point it at a project holding real data.

### Help assistant evaluation

```bash
node scripts/eval-assistant.mjs
```

Runs the assistant's evaluation cases (answers, prompt injection, unknown questions, a safety
judgement) against the configured models. It needs `OPENROUTER_API_KEY` and refuses to run
unless every configured model is a `:free` model. Pass thresholds: 80 % on answer cases, 100 % on
injection, unknown and safety cases. Retrieval and guards are covered offline by
`unit/assist.test.mjs`.

### Flutter client

Flutter is not on PATH on the development machine; use `~/develop/flutter/bin/flutter.bat` and
`dart.bat`. Run these **in this order**:

```bash
cd mobile
dart format --output=none --set-exit-if-changed lib test   # 1. format FIRST — see below
flutter analyze          # 2. must print "No issues found!" — infos count
flutter test             # 3. 447 tests, all passing on 2026-11-25
flutter build apk --release                                # 4. unsigned without key.properties
```

Format before analyzing: some lints only fire once the formatter moves code onto separate lines.
`dart format` splits a long one-line `if (x) return;`, and
`curly_braces_in_flow_control_structures` fires only once the body sits on its own line — so an
unformatted tree can pass `analyze` and fail CI. Do not run `flutter test` during a Gradle build;
both write into `mobile/build/`.

### What CI runs

`.github/workflows/ci.yml` has five jobs:

| Job | What it runs | Needs secrets |
|---|---|---|
| Static gates | `test:config`, `test:schema`, `test:deploy`, `test:unit`, lint, `tsc --noEmit`, `build`, `build:server` | No — runs on forks |
| Local stack + browser flows | `supabase start`, `test:local` (billing suite skipped — no Stripe key in CI), `test:browser` (Playwright + axe) | No |
| Live service gates | Dependencies, generated types, `test:rls`, migrations applied, Supabase advisors | Yes — not run on forks or Dependabot pull requests; in this repository a missing secret fails the job |
| Flutter (Android) | format, `analyze --fatal-infos`, `test`, release APK; `apksigner verify` must fail with no keystore; the built manifest must not allow cleartext or be debuggable | No |
| Flutter (iOS, unsigned) | `flutter build ios --release --no-codesign` on `macos-latest` — proves it compiles, nothing more | No |

Security scanning runs separately: gitleaks and semgrep in `.github/workflows/security.yml`, and
gitleaks, bandit and semgrep locally through `.pre-commit-config.yaml`.

## Commit messages

Conventional prefixes (`feat`, `fix`, `docs`, `test`, `ci`, `chore`) with a scope where it helps.
Say *why* in the body, especially for a fix: what broke, how it was found, and what now prevents
it happening again.
