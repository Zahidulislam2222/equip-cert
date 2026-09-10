/// Reject passwords that appear in known breach corpora.
///
/// A faithful port of `src/lib/password-safety.ts`. Both clients sign up against the same
/// Supabase project, so a rule enforced on only one of them is not enforced at all — a weak
/// password refused by the web form would simply be accepted by the phone.
///
/// ---------------------------------------------------------------------------------------
/// WHY THIS IS HAND-ROLLED
///
/// Supabase ships exactly this as "leaked password protection", and `supabase db advisors
/// --type security` flags the project for having it off. It is a **Pro-plan feature**, and
/// this project is on the free plan and staying there. Rather than record the advisory as an
/// accepted risk, the same check runs against the same upstream corpus, which is free and
/// needs no API key.
///
/// ---------------------------------------------------------------------------------------
/// HOW IT STAYS PRIVATE — the k-anonymity range protocol
///
/// The password never leaves the device, and neither does its full hash:
///
///   1. SHA-1 the password locally.
///   2. Send only the first FIVE hex characters of that hash to the range endpoint.
///   3. The service returns every known hash suffix sharing that prefix — several hundred.
///   4. Match the remaining 35 characters locally.
///
/// The service sees a 5-character prefix shared by hundreds of thousands of distinct
/// passwords. It never sees the password, never sees the full hash, and cannot tell which of
/// the returned suffixes — if any — was the one being asked about.
///
/// SHA-1 is correct here and is not a security decision. It is the index format the corpus is
/// published in; the hash is never stored, never transmitted in full, and never authenticates
/// anything.
///
/// ---------------------------------------------------------------------------------------
/// WHY BREACH-CHECKING RATHER THAN COMPOSITION RULES
///
/// NIST SP 800-63B explicitly recommends checking candidates against breach lists and
/// explicitly recommends AGAINST composition rules ("must contain a symbol"), which push
/// people toward predictable substitutions. So the project raised `minimum_password_length`
/// to 12, left `password_requirements` empty, and does this instead.
library;

import 'dart:async';
import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:meta/meta.dart';

import '../config/app_config.dart';

@immutable
sealed class PasswordVerdict {
  const PasswordVerdict();

  bool get ok => this is PasswordOk;
}

class PasswordOk extends PasswordVerdict {
  const PasswordOk();
}

class PasswordTooShort extends PasswordVerdict {
  const PasswordTooShort(this.minLength);
  final int minLength;
}

class PasswordBreached extends PasswordVerdict {
  const PasswordBreached(this.occurrences);
  final int occurrences;
}

/// The breach lookup, isolated so a test can substitute an [http.Client] and so the widget
/// layer never has to know the protocol exists.
class PasswordSafety {
  PasswordSafety({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;

  /// SHA-1 of [input], uppercase hex — the format the corpus is indexed in.
  ///
  /// UTF-8 encoded, matching the web client's `TextEncoder`. A password containing any
  /// non-ASCII character would otherwise hash differently on the two clients and be rejected
  /// on one and accepted on the other.
  static String sha1Hex(String input) =>
      sha1.convert(utf8.encode(input)).toString().toUpperCase();

  /// How many times this password appears in the breach corpus, or 0.
  ///
  /// Returns 0 when the lookup itself fails. A breach-list outage must not become a signup
  /// outage: length is still enforced, and failing closed here would lock every new user out
  /// because a third-party service was down. That is a deliberate, documented trade — the
  /// same one the web client makes.
  ///
  /// It matters more on mobile than on the web: a technician signing up on a plant-room
  /// connection will hit this timeout routinely, and an unreachable corpus is the NORMAL case
  /// there, not an incident.
  Future<int> breachCount(String password) async {
    final String hash;
    try {
      hash = sha1Hex(password);
    } catch (_) {
      return 0;
    }

    final String prefix = hash.substring(0, 5);
    final String suffix = hash.substring(5);

    try {
      final Uri uri = Uri.parse('${PasswordSafetyConfig.rangeUrl}/$prefix');
      final http.Response response = await _client
          .get(
            uri,
            // Adds random decoy hashes to the response so its SIZE leaks nothing either —
            // without padding, an observer counting bytes can narrow the prefix.
            headers: const <String, String>{'Add-Padding': 'true'},
          )
          .timeout(Duration(milliseconds: PasswordSafetyConfig.timeoutMs));

      if (response.statusCode != 200) return 0;

      for (final String line in const LineSplitter().convert(response.body)) {
        final int separator = line.indexOf(':');
        if (separator < 0) continue;
        if (line.substring(0, separator).trim() != suffix) continue;
        return int.tryParse(line.substring(separator + 1).trim()) ?? 0;
      }
      return 0;
    } on TimeoutException {
      return 0;
    } catch (_) {
      return 0;
    }
  }

  /// Full check used by the signup and password-change forms.
  Future<PasswordVerdict> check(String password) async {
    if (password.length < PasswordSafetyConfig.minLength) {
      return PasswordTooShort(PasswordSafetyConfig.minLength);
    }

    final int occurrences = await breachCount(password);
    if (occurrences > 0) return PasswordBreached(occurrences);

    return const PasswordOk();
  }

  void dispose() => _client.close();
}

/// Message shown to the person. Phrased as guidance, never as blame.
String? describeVerdict(PasswordVerdict verdict) => switch (verdict) {
  PasswordOk() => null,
  PasswordTooShort(:final int minLength) =>
    'Use at least $minLength characters. Length matters far more than symbols.',
  PasswordBreached(:final int occurrences) =>
    'This password has appeared in ${_grouped(occurrences)} known data breaches, '
        'so attackers already try it. Choose a different one.',
};

/// Thousands separators, matching the web client's `toLocaleString()`.
///
/// Written out rather than pulled from `package:intl`: the number is a plain count and adding
/// a localisation dependency plus its message catalogues to format one integer is not a
/// trade worth making.
String _grouped(int value) {
  final String digits = value.toString();
  final StringBuffer out = StringBuffer();
  for (int i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) out.write(',');
    out.write(digits[i]);
  }
  return out.toString();
}
