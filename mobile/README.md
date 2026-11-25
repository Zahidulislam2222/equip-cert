# EquipCert AI — Flutter client (Android + iOS)

The native client for fire-safety equipment inspection. It shares its backend, database schema
and compliance contracts with the Next.js client in `../src`; it is not a wrapper around it.

The reason it exists as a separate client rather than a Capacitor shell is the offline queue.
Extinguishers live in plant rooms, stairwell cores, basements and riser cupboards — the places
with no signal, by construction. An inspection app that needs connectivity at the moment of
inspection is an office app, and the technician works around it on paper, which is the workflow
this product exists to replace.

**Status (2026-11-25).** The Android release build and the iOS compile run in CI on every push.
The app is **not published** in Google Play or the App Store, and the iOS build is unsigned (see
[iOS](#ios)). It talks to the same hosted Supabase backend as the web client (EU Central,
Frankfurt), which answered the read-only production check on 2026-11-25. All 11 migrations in
`../supabase/migrations` are applied and tracked there (CI live job, run 45613839373).

---

## Quick start

Flutter is **not on PATH** on the development machine. Use the absolute path, and run the gates
in this order — format first, for the reason given under [Tests](#tests):

```bash
~/develop/flutter/bin/flutter.bat pub get
~/develop/flutter/bin/dart.bat format --output=none --set-exit-if-changed lib test
~/develop/flutter/bin/flutter.bat analyze     # gate: "No issues found!" — infos count
~/develop/flutter/bin/flutter.bat test        # gate: all tests pass
```

Toolchain this was developed and verified against: **Flutter 3.47.3 / Dart 3.13.3**. The CI jobs
in `.github/workflows/ci.yml` pin the same version.

---

## What the client does

Each item below is in `lib/`; the file named is where to start reading.

| Feature | Behaviour | Where |
|---|---|---|
| Sign-in and sign-up | A new account becomes the administrator of a new organisation, created by one server-side transaction (`provision_account`). Passwords are checked against known breaches by k-anonymity before sign-up | `src/auth/` |
| Inspection | Checklist, photo, GPS, optional AI analysis, signature | `src/screens/inspect_screen.dart` |
| Checklist selection | The CMS checklist whose equipment type matches the equipment by whole words; if the CMS has none for that type, the built-in NFPA 10 §7.2 monthly checks; if the CMS is unreachable or not configured, the same built-in checks. Never an empty list, and the screen says which one it is showing. Same rule as the web client's `pickChecklist` in `../src/lib/checklists.ts` | `src/data/checklist_repository.dart` |
| Contentful is optional | With no Contentful values in the build the app runs and uses the built-in checklist | `src/data/checklist_repository.dart` |
| E-signature consent | The signature pad accepts no stroke until "I agree to sign electronically" is ticked, for that inspection. Unticking clears the signature | `src/widgets/esign_consent.dart` |
| Consent evidence | Before a signed record is filed, the client calls `record_esign_consent` with the wording version shown. The **database** stamps the time and refuses a signed inspection from someone with no recorded consent, so the rule does not depend on the client | `src/data/inspection_repository.dart`, `../supabase/migrations/20261125000100_tenancy_invites_consent.sql` |
| Plan gating | The signature pad is shown only on plans that include signatures; the list is a contract test against `../src/lib/plans.ts`, and the database enforces it independently | `src/data/models.dart` |
| AI disclosure | EU AI Act Art. 50 provenance is shown before the inspector can sign an AI-assisted result | `src/widgets/ai_disclosure.dart`, `src/compliance/` |
| Help assistant | `/app/help`. Says it is an AI assistant before the first question, answers through the backend `POST /api/assist` with the user's session, shows which help articles an answer came from, lets the user stop waiting or start over, and always offers a human route | `src/screens/help_screen.dart`, `src/data/assist_api.dart` |
| Offline queue | Inspections captured with no connection are stored in sqflite with a SHA-256 integrity digest and sent later — see below | `src/offline/` |
| Corrective actions, equipment, inspection history, settings | Read and act on the organisation's own records under RLS | `src/screens/` |

**Invitations are accepted on the web, not in this app.** An invited person opens the invitation
link in a browser, creates or signs in to their account there, and can then sign in on the phone.
The app never creates an organisation for an account without one.

### When offline work is sent

- **When the app starts with a connection.** Anything queued in an earlier session is sent at
  start-up. (Before 2026-11-25 it was sent only on an offline-to-online transition, so an app
  opened in signal kept yesterday's queue.)
- **When the connection comes back** while the app is open.
- **When someone signs in.** Items are only sent by a signed-in session.

Connectivity is treated as a hint, not proof: the send attempt decides whether it worked, and a
failure is retried a bounded number of times. Two drains never run at once, because both would
file the same inspection twice. A **signed** record queued on a shared phone is held until the
person who signed it signs in, so consent is never recorded for whoever happens to sync.

---

## Configuration — there is no `.env`

A released app has no shell to inherit an environment from. Configuration is therefore
compile-time, supplied as `--dart-define` values, and

> **`lib/src/config/app_config.dart` is the sole owner of `String.fromEnvironment` in this
> package.** (`npm run test:config` at the repository root enforces it and scans `mobile/lib`
> and `mobile/test`.)

To build with real values:

```bash
cp dart_define.example.json dart_define.json      # dart_define.json is gitignored
# fill in the real values (kept outside the repository)
~/develop/flutter/bin/flutter.bat build apk --release --dart-define-from-file=dart_define.json
```

Every key in `dart_define.example.json` must exist in `app_config.dart` and vice versa; the
config gate fails the build in both directions. `APP_URL` is the backend the AI analysis and the
help assistant call; left blank, both report "not configured" instead of failing.

**`SUPABASE_SERVICE_ROLE_KEY` must never appear in a `--dart-define`, in an asset, or anywhere
under `mobile/`.** It bypasses RLS, and an APK is a zip file anyone can unpack. It belongs to
the server handlers in `../api` only.

Without a `dart_define.json` the app still compiles — the defaults are blank — and then fails
closed at startup with a message rather than running against nothing.

---

## Layout

```
lib/
  main.dart                  Fail-closed startup, ProviderScope, MaterialApp.router,
                             portrait lock, text scale clamped 1.0-1.6, queue drain at
                             start-up and on sign-in
  src/
    app/router.dart          Route constants, redirect-based auth gate, splash
    auth/                    Sign-in, sign-up, breached-password check, session controller
    compliance/              EU AI Act Art. 50 provenance validation
    config/app_config.dart   SOLE owner of String.fromEnvironment
    data/                    Models, Supabase client, evidence, inspections, capture,
                             analyze API, assist API, checklists, location, secure session storage
    offline/                 sqflite queue with a SHA-256 integrity digest, sync controller
    screens/                 Home, inspect, corrective actions, inspections, detail,
                             equipment, help, settings
    theme/app_theme.dart     AppColors / AppMetrics / AppFonts / AppTheme
    util/                    UUID generation
    widgets/                 Shared controls, signature pad, AI disclosure, e-sign consent
test/                        447 unit + widget tests, described below
```

### Design system

Dark-first, **Safety Yellow** `hsl(45 100% 55%)`, Archivo display / Inter body. The tokens are
owned by `../src/app/globals.css`, and `test/theme_tokens_test.dart` fails if this client's
theme drifts from them.

Every colour in `src/screens/` and `src/widgets/` comes from `colorsOf(context)`. There is
exactly one hex literal in the UI layer, in the signature pad's PNG export, and it is
deliberate: the export is opaque **black ink on white**, at a fixed 600×200 regardless of
device, because that image is printed evidence rather than UI.

---

## Tests

```bash
~/develop/flutter/bin/dart.bat format --output=none --set-exit-if-changed lib test
~/develop/flutter/bin/flutter.bat analyze
~/develop/flutter/bin/flutter.bat test
```

**Format first.** `flutter analyze` on an unformatted tree can pass and then fail in CI: the
formatter splits a long one-line `if (x) return;` across two lines, and
`curly_braces_in_flow_control_structures` only fires once the body is on its own line. A green
`analyze` on an unformatted tree is not evidence CI will agree.

| File | Covers |
|---|---|
| `offline_integrity_test.dart` | Canonical JSON ordering; the digest's splice detection |
| `sync_service_test.dart` | When the offline queue drains — connectivity is treated as a hint, not proof; drain at start-up |
| `sync_batch_test.dart` | Which queued records one sync pass may send — a colleague's signed record is held |
| `ai_provenance_test.dart` | Art. 50 parsing — including the string `"false"` |
| `ai_disclosure_widget_test.dart` | Art. 50(1) — the AI disclosure is on screen before the inspector can sign (widget test) |
| `analyze_api_test.dart` | The boundary where an AI response becomes part of a safety record |
| `assist_copy_contract_test.dart` | The help assistant's disclosure and copy match `../src/content/assistant.json` |
| `esign_consent_contract_test.dart` | The consent wording and version match `../src/content/esign-consent.json` |
| `esign_consent_widget_test.dart` | The signature pad accepts no stroke until consent is given (widget test) |
| `plan_gating_contract_test.dart` | Which plans may sign, against `../src/lib/plans.ts` |
| `inspection_payload_test.dart` | `GeoPoint`, `statusFor`, both insert payload builders |
| `capture_downscale_test.dart` | Resize, EXIF baking, undecodable input |
| `checklist_repository_test.dart` | Checklist matching by whole words; a checklist is never empty — a CMS failure falls back instead of offering nothing to answer |
| `schema_contract_test.dart` | Every `json['...']` key against `../supabase/migrations` |
| `theme_tokens_test.dart` | Theme tokens against `../src/app/globals.css` |
| `password_safety_test.dart` | k-anonymity breach check |
| `slug_test.dart` | Organisation slug generation |
| `evidence_path_test.dart` | Uploaded photos and signatures land under the caller's own tenant path |
| `secure_session_storage_test.dart` | The refresh token is kept in platform secure storage, never plain preferences |

Eight of these read files **outside** `mobile/`: the schema contract parses the migrations, the
theme test parses the web stylesheet, the capture test reads `ANALYZE_MAX_IMAGE_BYTES` out of
`../.env.example`, the assistant, e-sign and plan-gating contracts read the web client's copy
and plan list, and the slug and evidence-path tests check their rules against the web and
database sources. That is deliberate — they are contract tests against the other client, and a
value with an owner should be read from its owner rather than copied. It is also why the CI job
is not path-filtered to `mobile/**`.

**447 tests, all passing** (`flutter test`, measured 2026-11-25). The AI disclosure and the
e-sign consent gate are widget-tested; the other screens are not yet, though the logic they call
is.

---

## Building for release

### Android

Release signing reads `android/key.properties`, which is gitignored along with the `.jks`
itself. The real values are kept outside the repository.

```bash
~/develop/flutter/bin/flutter.bat build apk --release --dart-define-from-file=dart_define.json
```

**If `key.properties` is absent the build produces an unsigned APK and does not fall back to the
debug key.** The Flutter scaffold this replaced did fall back, under a `// TODO`, and that is a
hazard rather than a placeholder: the debug keystore ships with the Android SDK, its password is
public, and an APK signed with it is installable, distributable, and updatable by anyone.

**The unsigned file is still named `app-release.apk`** — Gradle does not rename it to
`app-release-unsigned.apk`. A check on the filename would therefore pass a debug-signed APK. CI
instead runs `apksigner verify` on the built APK and fails if verification **succeeds** when no
keystore is configured, and it asserts the built release manifest (no cleartext traffic, not
debuggable) rather than the source one.

**⚠️ The `.jks` is the app's identity on Google Play.** Lose it and no update to an
already-installed app can ever be signed again — the only remedy is a new package name and
asking every user to reinstall. It is gitignored, so it is in no repository backup. An encrypted
backup exists, but it is still on the development machine; an off-machine copy is outstanding.

Code shrinking (`isMinifyEnabled`) is deliberately **off**. R8 strips reflection targets, which
is how plugin registration in `image_picker`, `geolocator` and `flutter_secure_storage` breaks —
in release only, at runtime, on a device, long after every gate has gone green. Turn it on when
there is a device to smoke-test the resulting APK on.

### iOS

**iOS cannot be built on Windows.** Xcode is macOS-only, so the development machine can
typecheck and test the Dart but cannot discover that a CocoaPods dependency fails to resolve or
that a plugin has no iOS implementation. That is what the `macos-latest` CI job is for:

```bash
flutter build ios --release --no-codesign
```

`--no-codesign` because signing requires the Apple Developer Program at $99/year, which is not
authorised. The job proves the project compiles. It does **not** produce an installable app, and
no claim beyond "it compiles" should be made from it.

---

## Platform configuration

| Concern | Where | What |
|---|---|---|
| Cleartext traffic | `android/app/src/main/res/xml/network_security_config.xml` | Forbidden, no per-domain exception, system CAs only |
| Android permissions | `android/app/src/main/AndroidManifest.xml` | INTERNET, ACCESS_NETWORK_STATE, CAMERA, FINE + COARSE location — each with a stated reason |
| iOS purpose strings | `ios/Runner/Info.plist` | Camera, photo library, location-when-in-use |
| iOS ATS | `ios/Runner/Info.plist` | `NSAllowsArbitraryLoads` false |

`READ_MEDIA_IMAGES` is deliberately absent: `image_picker` uses the system photo picker, which
returns the one file the person chose. Requesting gallery-wide read access to obtain a picture
they already selected is not a trade worth making. `ACCESS_BACKGROUND_LOCATION` is absent for
the same kind of reason — location is only read while the inspection screen is in the
foreground.

Both `uses-feature` entries are `required="false"`. A tablet with no camera or no GPS can still
file an inspection: the manual path files one with no photo, and a refused or unavailable fix
files one with no coordinates.

---

## Things that will bite you

- **`AsyncValue.valueOrNull` does not exist** in Riverpod 3.4.3. It is `.value`, and `.value` is
  nullable. `FutureProviderFamily` is not exported by `flutter_riverpod` either, so family
  providers use inferred types with the arguments pinned on `.family<T, Arg>`.
- **`img.decodeImage` throws** on a buffer too short for the header it is probing; it does not
  return null. `CaptureService.downscale` catches it. See DEF-050.
- **A `--dart-define` is compiled in.** Rotating the Supabase anon key or the Contentful token
  means rebuilding and reshipping the app, not editing a config file.
- **Copied copy must stay identical.** The e-sign wording and the assistant's disclosure exist
  in this client and in `../src/content/`; a released app cannot read the repository. Change both
  in the same commit, or the contract tests fail.
- **The version pinned in `pubspec.lock` is the API**, not the one in training data or the last
  tutorial. Read the installed package source under
  `~/AppData/Local/Pub/Cache/hosted/pub.dev/` when in doubt.
- **Do not run `flutter test` while a Gradle build is running.** Both write into `mobile/build/`
  and the Kotlin incremental compiler fails with "Could not close incremental caches" on
  Windows.
