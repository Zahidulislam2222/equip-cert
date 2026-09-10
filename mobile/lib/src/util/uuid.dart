/// RFC 9562 version-4 UUIDs, generated on the device.
///
/// ---------------------------------------------------------------------------------------
/// WHY THE CLIENT GENERATES IDS AT ALL
///
/// Two reasons, both structural:
///
/// 1. **`INSERT ... RETURNING` is a SELECT.** Under row-level security, PostgreSQL applies the
///    table's SELECT policies to a `RETURNING` clause. `organizations_select_own` matches on
///    `id = app.current_org_id()`, which reads from `profiles` — and during signup the caller
///    has no profile yet, so it is NULL. A newly inserted organisation is therefore invisible
///    to the very session that just created it, and `.insert(...).select().single()` comes back
///    with no rows. Generating the id here means nothing has to be read back.
///
/// 2. **Offline.** A queued inspection needs a stable identity the moment it is captured in a
///    basement with no signal, not whenever the server is next reachable. Evidence object
///    paths embed it (`orgId/kind/uuid.ext`), so it has to exist before the upload.
///
/// ---------------------------------------------------------------------------------------
/// [Random.secure] IS NOT OPTIONAL HERE
///
/// The default [Random] is a seeded PRNG. Its output is predictable from a handful of prior
/// values, and these ids appear in evidence object paths — the third path segment is random
/// precisely so an object's address cannot be derived from a clock or a counter (DEF-017).
/// A predictable generator would hand that property straight back.
///
/// [Random.secure] draws from the platform CSPRNG and throws if none is available, which is
/// the correct failure: better to fail loudly than to quietly issue guessable identifiers.
library;

import 'dart:math';

final Random _random = Random.secure();

const String _hex = '0123456789abcdef';

/// A version-4, variant-1 UUID in canonical 8-4-4-4-12 lowercase form.
String uuidV4() {
  final List<int> bytes = List<int>.generate(16, (_) => _random.nextInt(256));

  // Version 4 in the high nibble of byte 6.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  // Variant 1 (10xxxxxx) in the top two bits of byte 8.
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  final StringBuffer out = StringBuffer();
  for (int i = 0; i < 16; i++) {
    if (i == 4 || i == 6 || i == 8 || i == 10) out.write('-');
    final int byte = bytes[i];
    out
      ..write(_hex[byte >> 4])
      ..write(_hex[byte & 0x0f]);
  }
  return out.toString();
}

/// A short lowercase alphanumeric token, for disambiguating a name collision.
///
/// Not an identifier and not a secret — it exists so that the second organisation called
/// "Acme" gets a slug the UNIQUE constraint will accept.
String shortToken([int length = 6]) {
  const String alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return String.fromCharCodes(
    List<int>.generate(
      length,
      (_) => alphabet.codeUnitAt(_random.nextInt(alphabet.length)),
    ),
  );
}
