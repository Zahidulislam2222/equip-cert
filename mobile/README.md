# EquipCert AI — Flutter client (Android + iOS)

The native client for fire-safety equipment inspection. It shares its backend, database schema
and compliance contracts with the Next.js client in `../src`; it is not a wrapper around it.

The reason it exists as a separate client rather than a Capacitor shell is the offline queue.
Extinguishers live in plant rooms, stairwell cores, basements and riser cupboards — the places
with no signal, by construction. An inspection app that needs connectivity at the moment of
inspection is an office app, and the technician works around it on paper, which is the workflow
this product exists to replace.

---

## Quick start

Flutter is **not on PATH** on the development machine. Use the absolute path:

```bash
~/develop/flutter/bin/flutter.bat pub get
~/develop/flutter/bin/flutter.bat analyze     # gate: "No issues found!" — infos count
~/develop/flutter/bin/flutter.bat test        # gate: all tests pass
```

Toolchain this was developed and verified against: **Flutter 3.47.3 / Dart 3.13.3**. The CI jobs
in `.github/workflows/ci.yml` pin the same version.

---

## Configuration — there is no `.env`

A released app has no shell to inherit an environment from. Configuration is therefore
compile-time, supplied as `--dart-define` values, and

> **`lib/src/config/app_config.dart` is the sole owner of `String.fromEnvironment` in this
> package.** (Global Rule 12. `npm run test:config` at the repository root enforces it and
> scans `mobile/lib` and `mobile/test`.)

To build with real values:

```bash
cp dart_define.example.json dart_define.json      # dart_define.json is gitignored
# fill in the real values — they are recorded in the gitignored CREDENTIALS.md, Section 16.1
~/develop/flutter/bin/flutter.bat build apk --release --dart-define-from-file=dart_define.json
```

Every key in `dart_define.example.json` must exist in `app_config.dart` and vice versa; the
config gate fails the build in both directions.

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
                             portrait lock, text scale clamped 1.0-1.6
  src/
    app/router.dart          Route constants, redirect-based auth gate, splash
    auth/                    Sign-in, sign-up, breached-password check, session controller
    compliance/              EU AI Act Art. 50 provenance validation
    config/app_config.dart   SOLE owner of String.fromEnvironment
    data/                    Models, Supabase client, evidence, inspections, capture,
                             analyze API, checklists, location
    offline/                 sqflite queue with a SHA-256 integrity digest, sync controller
    screens/                 Home, inspect, corrective actions, inspections, detail,
                             equipment, settings
    theme/app_theme.dart     AppColors / AppMetrics / AppFonts / AppTheme
    widgets/                 Shared controls, signature pad, AI disclosure
test/                        245 unit tests, described below
```

### Design system

Dark-first, **Safety Yellow** `hsl(45 100% 55%)`, Archivo display / Inter body — the approved
design, recorded in `memory/project-design-system.md`. The "Industrial Premium" blue-and-orange
section in the root `AGENTS.md` and the screenshots under `my-project-view/Frontend/` are both
**stale**; do not build against either.

Every colour in `src/screens/` and `src/widgets/` comes from `colorsOf(context)`. There is
exactly one hex literal in the UI layer, in the signature pad's PNG export, and it is
deliberate: the export is opaque **black ink on white**, at a fixed 600×200 regardless of
device, because that image is printed evidence rather than UI.

---

## Tests

```bash
~/develop/flutter/bin/flutter.bat test
```

| File | Covers |
|---|---|
| `offline_integrity_test.dart` | Canonical JSON ordering; the digest's splice detection |
| `ai_provenance_test.dart` | Art. 50 parsing — including the string `"false"` |
| `inspection_payload_test.dart` | `GeoPoint`, `statusFor`, both insert payload builders |
| `capture_downscale_test.dart` | Resize, EXIF baking, undecodable input |
| `schema_contract_test.dart` | Every `json['...']` key against `../supabase/migrations` |
| `theme_tokens_test.dart` | Theme tokens against `../src/app/globals.css` |
| `password_safety_test.dart` | k-anonymity breach check |
| `slug_test.dart` | Organisation slug generation |

Three of these read files **outside** `mobile/`: the schema contract parses the migrations, the
theme test parses the web stylesheet, and the capture test reads `ANALYZE_MAX_IMAGE_BYTES` out
of `../.env.example`. That is deliberate — they are contract tests against the other client, and
a value with an owner should be read from its owner rather than copied. It is also why the CI
job is not path-filtered to `mobile/**`.

**Not covered:** the screens (no widget tests), `SyncService`, `ChecklistRepository`,
`AnalyzeApi`.

---

## Building for release

### Android

Release signing reads `android/key.properties`, which is gitignored along with the `.jks`
itself. The real values are in the gitignored `CREDENTIALS.md`, Section 16.2.

```bash
~/develop/flutter/bin/flutter.bat build apk --release --dart-define-from-file=dart_define.json
```

**If `key.properties` is absent the build produces `app-release-unsigned.apk` and does not fall
back to the debug key.** The Flutter scaffold this replaced did fall back, under a `// TODO`,
and that is a hazard rather than a placeholder: the debug keystore ships with the Android SDK,
its password is public, and an APK signed with it is installable, distributable, and updatable
by anyone. The CI job asserts the unsigned output, so the guarantee is tested rather than
assumed.

**⚠️ The `.jks` is the app's identity on Google Play.** Lose it and no update to an
already-installed app can ever be signed again — the only remedy is a new package name and
asking every user to reinstall. It exists in one place on one machine and is gitignored, so it
is in no repository backup. Back it up somewhere else.

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
authorised. The job proves the project builds. It does **not** produce an installable app, and
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
- **The version pinned in `pubspec.lock` is the API**, not the one in training data or the last
  tutorial. Read the installed package source under
  `~/AppData/Local/Pub/Cache/hosted/pub.dev/` when in doubt.
- **Do not run `flutter test` while a Gradle build is running.** Both write into `mobile/build/`
  and the Kotlin incremental compiler fails with "Could not close incremental caches" on
  Windows.
