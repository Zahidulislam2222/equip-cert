// Central configuration for the Flutter client — Global Rule 12, mobile half.
//
// This file is the ONLY place in `mobile/` permitted to read a compile-time environment
// value. `npm run test:config` enforces that from the repository root and fails the build
// otherwise, exactly as it does for `src/lib/config.ts` on the web side.
//
// ---------------------------------------------------------------------------------------
// WHY `String.fromEnvironment` AND NOT A .env FILE
//
// A released mobile app has no shell to inherit an environment from, and a `.env` bundled as
// an asset is just a plaintext file inside a zip anyone can unpack. Dart's answer is
// `--dart-define`, which substitutes the value at COMPILE time. That makes these values
// exactly as baked-in as `NEXT_PUBLIC_*` in the Next.js export — and exactly as public.
//
// So the rule is the same rule: only values that may safely ship inside a client binary go
// here. The Supabase anon key belongs here (it is designed to be public and is useless
// without a session and RLS). The service-role key does NOT, and never will — it bypasses
// RLS, and putting it in a define would publish it to every device.
//
// ---------------------------------------------------------------------------------------
// EVERY ONE OF THESE MUST BE `static const`
//
// `String.fromEnvironment` only reads the define in a CONST context. Written as a non-const
// expression it silently returns the default forever — the app compiles, runs, and quietly
// talks to nothing. That failure is invisible at every gate except a live run, which is why
// this comment is here and why `dart_define.example.json` is checked against this file.
//
// Build with:
//   flutter build apk --release --dart-define-from-file=dart_define.json
//
// `dart_define.json` is gitignored and holds the real values; `dart_define.example.json` is
// committed and holds names and placeholders only. Real values also live in the gitignored
// CREDENTIALS.md (Rule 8), which is the recovery source.
// ---------------------------------------------------------------------------------------

/// Application identity.
class AppInfo {
  const AppInfo._();

  static const String name = String.fromEnvironment(
    'APP_NAME',
    defaultValue: 'EquipCert AI',
  );

  /// Origin that serves the standalone API handlers (`/api/analyze`, `/api/dsar`).
  ///
  /// Empty by default and NOT defaulted to a localhost address. A phone cannot reach the
  /// developer's localhost, so a localhost default would produce a connection error that
  /// looks like a bug in the AI provider. Empty makes [AnalyzeApi.isConfigured] false and the
  /// UI say the honest thing instead.
  static const String apiBaseUrl = String.fromEnvironment('APP_URL');
}

/// Supabase — auth, database, storage.
class SupabaseConfig {
  const SupabaseConfig._();

  static const String url = String.fromEnvironment('SUPABASE_URL');

  /// Public by design. RLS is what protects the data; this key only identifies the project.
  static const String anonKey = String.fromEnvironment('SUPABASE_ANON_KEY');

  static bool get isConfigured => url.isNotEmpty && anonKey.isNotEmpty;
}

/// Evidence storage.
///
/// The bucket name and path shape are a CONTRACT with
/// `supabase/migrations/20260910000300_storage.sql`. They are constants rather than defines
/// because they are not environment-specific: changing either without changing the migration
/// breaks uploads at runtime, not at build time — the storage policy simply stops matching
/// and the error is a generic 400.
///
/// This is the same contract `src/lib/evidence.ts` implements for the web client. DEF-017 —
/// a public bucket, timestamp filenames, no tenant in the path — became permanent because
/// the shape was restated at every call site. One definition, two runtimes.
class EvidenceConfig {
  const EvidenceConfig._();

  /// Must equal the bucket created in the storage migration. Private.
  static const String bucket = 'evidence';

  /// Seconds a signed view URL stays valid. Long enough for a page view and a report render,
  /// short enough that a leaked link stops working.
  static const int signedUrlTtlSeconds = int.fromEnvironment(
    'EVIDENCE_URL_TTL_SECONDS',
    defaultValue: 600,
  );

  /// First path segment is the organisation, so `storage.foldername(name)[1]` in the policy
  /// has something to scope by. Second is what the object is evidence OF. Third is random,
  /// so the address cannot be derived from a clock.
  static String objectPath({
    required String organizationId,
    required String kind,
    required String id,
    required String extension,
  }) => '$organizationId/$kind/$id.$extension';
}

/// Photo capture — client-side downscale applied before upload.
///
/// A phone camera frame is 4-12 MB. Shrinking here keeps the request inside the analyze
/// endpoint's `ANALYZE_MAX_IMAGE_BYTES`, cuts mobile data on a plant-room connection, and
/// keeps the AI request cheap. The same two numbers govern the web client.
class CaptureConfig {
  const CaptureConfig._();

  static const int maxEdgePx = int.fromEnvironment(
    'CAPTURE_MAX_EDGE_PX',
    defaultValue: 1600,
  );

  /// Whole-number percentage, because defines parse as integers.
  static const int jpegQualityPercent = int.fromEnvironment(
    'CAPTURE_JPEG_QUALITY',
    defaultValue: 85,
  );
}

/// Password safety.
///
/// Supabase's own leaked-password protection is a Pro-plan feature and this project is on the
/// free plan, so the same check runs against the same upstream corpus through the free
/// k-anonymity range API. Only the first five characters of the SHA-1 ever leave the device.
///
/// [minLength] must stay in step with `minimum_password_length` in `supabase/config.toml`,
/// which is the actual enforcer. This value only decides what the form says first.
class PasswordSafetyConfig {
  const PasswordSafetyConfig._();

  static const String rangeUrl = String.fromEnvironment(
    'PWNED_RANGE_URL',
    defaultValue: 'https://api.pwnedpasswords.com/range',
  );

  static const int minLength = int.fromEnvironment(
    'PASSWORD_MIN_LENGTH',
    defaultValue: 12,
  );

  /// A breach-list outage must not become a signup outage.
  static const int timeoutMs = int.fromEnvironment(
    'PWNED_TIMEOUT_MS',
    defaultValue: 4000,
  );
}

/// Contentful — the equipment checklists.
class ContentfulConfig {
  const ContentfulConfig._();

  static const String baseUrl = String.fromEnvironment(
    'CONTENTFUL_BASE_URL',
    defaultValue: 'https://cdn.contentful.com',
  );

  static const String spaceId = String.fromEnvironment('CONTENTFUL_SPACE_ID');

  static const String accessToken = String.fromEnvironment(
    'CONTENTFUL_ACCESS_TOKEN',
  );

  static const String environment = String.fromEnvironment(
    'CONTENTFUL_ENVIRONMENT',
    defaultValue: 'master',
  );

  static const String contentType = String.fromEnvironment(
    'CONTENTFUL_CHECKLIST_TYPE',
    defaultValue: 'checklist',
  );

  static const int timeoutMs = int.fromEnvironment(
    'CONTENTFUL_TIMEOUT_MS',
    defaultValue: 8000,
  );

  static bool get isConfigured => spaceId.isNotEmpty && accessToken.isNotEmpty;
}

/// Geolocation.
class GeoConfig {
  const GeoConfig._();

  static const String reverseGeocodeUrl = String.fromEnvironment(
    'REVERSE_GEOCODE_URL',
    defaultValue: 'https://nominatim.openstreetmap.org/reverse',
  );

  static const int gpsTimeoutMs = int.fromEnvironment(
    'GPS_TIMEOUT_MS',
    defaultValue: 10000,
  );

  /// Nominatim's usage policy requires a contactful User-Agent identifying the application.
  /// Anonymous bulk traffic gets blocked, and a blocked geocoder means every inspection files
  /// without an address.
  static const String reverseGeocodeUserAgent = String.fromEnvironment(
    'REVERSE_GEOCODE_USER_AGENT',
    defaultValue: 'EquipCertMobile/1.0 (+https://equipcert.zahidul-islam.com)',
  );
}

/// Offline queue.
///
/// The queue is the difference between "an app for a plant room" and "an app for an office".
/// A technician in a basement with no signal must still be able to complete and sign an
/// inspection; it syncs when they walk out.
class OfflineConfig {
  const OfflineConfig._();

  /// How many queued submissions to attempt per sync pass. Bounded so a long backlog on a
  /// weak connection does not hold the app busy indefinitely.
  static const int syncBatchSize = int.fromEnvironment(
    'OFFLINE_SYNC_BATCH',
    defaultValue: 10,
  );

  /// Give up on a queued item after this many failed sync attempts and surface it to the
  /// technician rather than retrying it silently for ever.
  static const int maxSyncAttempts = int.fromEnvironment(
    'OFFLINE_MAX_ATTEMPTS',
    defaultValue: 5,
  );
}

/// Network timeouts shared by the plain-HTTP callers.
class NetworkConfig {
  const NetworkConfig._();

  static const int analyzeTimeoutMs = int.fromEnvironment(
    'ANALYZE_TIMEOUT_MS',
    defaultValue: 45000,
  );
}
