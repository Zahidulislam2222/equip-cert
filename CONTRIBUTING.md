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
   `src/lib/config.ts` — nothing else reads `process.env`. Plan prices and limits live only in
   `src/lib/plans.ts`. Deployment values live only in `deploy/deploy.config.json`. Mobile
   configuration lives only in `mobile/lib/src/config/app_config.dart`. `npm run test:config`
   fails the build when a value escapes its owner.
2. **No secrets in the repository.** Not in code, tests, fixtures or docs. Tests use obviously
   fake values. `.env.example` holds names and placeholders only.
3. **Adding an environment variable** means updating `src/lib/config.ts` *and* `.env.example`.
4. **Every tenant table** carries `organization_id` and row-level security policies `TO authenticated`
   (`plan_limits` is the one shared, read-only table).
   Schema changes are new files in `supabase/migrations/`; an applied migration is never edited.
5. **Signed inspection records are immutable.** Do not add a code path that updates one.
6. **No hand-edited generated files.** `deploy/generated/` and `deploy/k8s/` come from
   `npm run deploy:gen`; CI fails if the manifests drift from their config.
7. **Claims need evidence.** Documentation says *measured*, *built* or *designed for*, and never
   blurs them.

## Gates

Run before opening a pull request. CI runs the same set and more.

```bash
npm run test:config      # configuration boundary
npm run lint             # ESLint over src/ api/ deploy/
npm test                 # config, plan limits, deploy manifests, unit tests
npm run build            # type check + static export
npm run build:server     # self-host adapter

cd mobile
dart format --output=none --set-exit-if-changed lib test   # format FIRST — see below
flutter analyze          # must print "No issues found!"
flutter test
```

Format before analyzing: some lints only fire once the formatter moves code onto separate lines,
so an unformatted tree can pass `analyze` and fail CI.

Database authorization changes also need `npm run test:rls` against a **local** Supabase stack
(`npx supabase start`) — never against a project holding real data.

## Commit messages

Conventional prefixes (`feat`, `fix`, `docs`, `test`, `ci`, `chore`) with a scope where it helps.
Say *why* in the body, especially for a fix: what broke, how it was found, and what now prevents
it happening again.
