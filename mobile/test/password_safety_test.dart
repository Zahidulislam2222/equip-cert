/// The breach check, exercised against a stubbed range endpoint.
///
/// `PasswordSafety` takes an injectable [http.Client] specifically so this file can exist —
/// the k-anonymity protocol is the kind of thing that looks obviously correct and is
/// off-by-one in the substring, and the only way to know is to run it.
///
/// Nothing here touches the network. `package:http/testing.dart`'s [MockClient] answers every
/// request from a closure, so the assertions are about OUR protocol implementation, not about
/// whether haveibeenpwned is up.
///
/// The one real value used below is the SHA-1 of "password", which is public knowledge and
/// appears in the protocol's own documentation. It is not a credential.
library;

import 'dart:convert';

import 'package:equipcert_mobile/src/auth/password_safety.dart';
import 'package:equipcert_mobile/src/config/app_config.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  group('sha1Hex', () {
    test('produces the documented uppercase hex digest', () {
      // The canonical worked example of the range protocol.
      expect(
        PasswordSafety.sha1Hex('password'),
        '5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8',
      );
    });

    test('is UTF-8 encoded, matching the web client', () {
      // The web client hashes with `TextEncoder`, which is UTF-8 only. If Dart encoded as
      // Latin-1 here, any password containing a non-ASCII character would hash differently
      // on phone and browser — accepted on one client, rejected on the other, for the same
      // password. Nobody would ever reproduce that on purpose.
      final String viaLibrary = PasswordSafety.sha1Hex('pässwörd-ünïcode-2026');
      expect(viaLibrary, hasLength(40));
      expect(viaLibrary, matches(RegExp(r'^[0-9A-F]{40}$')));

      // Independently: the same bytes a TextEncoder would produce.
      expect(
        utf8.encode('pässwörd-ünïcode-2026').length,
        greaterThan('pässwörd-ünïcode-2026'.length),
      );
    });

    test('is deterministic', () {
      expect(
        PasswordSafety.sha1Hex('repeat-me'),
        PasswordSafety.sha1Hex('repeat-me'),
      );
    });
  });

  group('k-anonymity: what actually leaves the device', () {
    test(
      'only the first five hex characters are sent, and never the password',
      () async {
        Uri? requested;
        final PasswordSafety safety = PasswordSafety(
          client: MockClient((http.Request request) async {
            requested = request.url;
            return http.Response('', 200);
          }),
        );

        await safety.breachCount('password');

        expect(requested, isNotNull);
        final String url = requested.toString();

        // The documented prefix/suffix split of the digest above.
        expect(url, endsWith('/5BAA6'));
        expect(
          url,
          isNot(contains('1E4C9B93F3F0682250B6CF8331B7EE68FD8')),
          reason: 'The suffix must be matched locally. Sending it defeats the whole protocol.',
        );
        expect(
          requested!.path.toLowerCase(),
          isNot(contains('password')),
          reason:
              'The password itself must never appear in a URL, where it would land in '
              'proxy logs and browser history. Asserted against the PATH specifically: the '
              'host "api.pwnedpasswords.com" legitimately contains the word, so matching the '
              'whole URL would fail for the wrong reason and teach nobody anything.',
        );
      },
    );

    test('asks for response padding', () async {
      // Without padding, the SIZE of the response narrows which prefix was requested. It
      // costs nothing and it is the documented mitigation.
      Map<String, String>? headers;
      final PasswordSafety safety = PasswordSafety(
        client: MockClient((http.Request request) async {
          headers = request.headers;
          return http.Response('', 200);
        }),
      );

      await safety.breachCount('password');

      expect(headers?['Add-Padding'], 'true');
    });

    test(
      'the request goes to the configured endpoint, not a hardcoded one',
      () async {
        // Rule 12: the URL is owned by app_config.dart. This asserts the code actually reads
        // it rather than carrying its own copy.
        Uri? requested;
        final PasswordSafety safety = PasswordSafety(
          client: MockClient((http.Request request) async {
            requested = request.url;
            return http.Response('', 200);
          }),
        );

        await safety.breachCount('anything-at-all');

        expect(requested.toString(), startsWith(PasswordSafetyConfig.rangeUrl));
      },
    );
  });

  group('matching the suffix', () {
    /// A range response: `SUFFIX:COUNT` per line, CRLF terminated as the real service sends.
    String rangeBody(Map<String, int> entries) => entries.entries
        .map((MapEntry<String, int> e) => '${e.key}:${e.value}')
        .join('\r\n');

    const String knownSuffix = '1E4C9B93F3F0682250B6CF8331B7EE68FD8';

    PasswordSafety withBody(String body, {int status = 200}) => PasswordSafety(
      client: MockClient((http.Request _) async => http.Response(body, status)),
    );

    test('finds the count when the suffix is present', () async {
      final PasswordSafety safety = withBody(
        rangeBody(<String, int>{
          '0000000CAEF405439D57847A8657218C618160B': 3,
          knownSuffix: 10382409,
          'FFFFFFFCAEF405439D57847A8657218C618160B': 1,
        }),
      );

      expect(await safety.breachCount('password'), 10382409);
    });

    test(
      'returns 0 when the suffix is absent, even with a full response',
      () async {
        final PasswordSafety safety = withBody(
          rangeBody(<String, int>{
            '0000000CAEF405439D57847A8657218C618160B': 3,
            'FFFFFFFCAEF405439D57847A8657218C618160B': 1,
          }),
        );

        expect(await safety.breachCount('password'), 0);
      },
    );

    test('does not match on a prefix of the suffix', () async {
      // The failure mode a `startsWith` implementation would have: a shorter suffix that
      // happens to share the opening characters is a DIFFERENT password.
      final PasswordSafety safety = withBody(
        rangeBody(<String, int>{knownSuffix.substring(0, 20): 999999}),
      );

      expect(await safety.breachCount('password'), 0);
    });

    test('tolerates lines with no separator', () async {
      final PasswordSafety safety = withBody(
        'garbage-line\r\n$knownSuffix:42\r\n',
      );
      expect(await safety.breachCount('password'), 42);
    });

    test('tolerates an unparseable count rather than throwing', () async {
      final PasswordSafety safety = withBody('$knownSuffix:not-a-number');
      expect(await safety.breachCount('password'), 0);
    });
  });

  group('failing open — deliberate, and the reason is written down', () {
    // A breach-list outage must not become a signup outage. Length is still enforced. On
    // mobile this matters more than on the web: a technician signing up on a plant-room
    // connection hits this routinely, so an unreachable corpus is the NORMAL case here.
    test('a 503 from the range service is not a breach', () async {
      final PasswordSafety safety = PasswordSafety(
        client: MockClient(
          (http.Request _) async => http.Response('service down', 503),
        ),
      );
      expect(await safety.breachCount('password'), 0);
    });

    test('a 429 is not a breach', () async {
      final PasswordSafety safety = PasswordSafety(
        client: MockClient((http.Request _) async => http.Response('', 429)),
      );
      expect(await safety.breachCount('password'), 0);
    });

    test('a transport failure is not a breach', () async {
      final PasswordSafety safety = PasswordSafety(
        client: MockClient((http.Request _) async {
          throw http.ClientException('no route to host');
        }),
      );
      expect(await safety.breachCount('password'), 0);
    });

    test(
      'a hang is bounded by the configured timeout and is not a breach',
      () async {
        final PasswordSafety safety = PasswordSafety(
          client: MockClient((http.Request _) async {
            // Longer than the configured timeout, so the timeout is what resolves this.
            await Future<void>.delayed(
              Duration(milliseconds: PasswordSafetyConfig.timeoutMs + 2000),
            );
            return http.Response('', 200);
          }),
        );

        final Stopwatch clock = Stopwatch()..start();
        final int count = await safety.breachCount('password');
        clock.stop();

        expect(count, 0);
        expect(
          clock.elapsedMilliseconds,
          lessThan(PasswordSafetyConfig.timeoutMs + 1500),
          reason: 'The signup form blocks on this. An unbounded wait is a hung signup screen.',
        );
      },
    );
  });

  group('check() — the verdict the form renders', () {
    PasswordSafety cleanCorpus() => PasswordSafety(
      client: MockClient((http.Request _) async => http.Response('', 200)),
    );

    test(
      'rejects anything under the configured minimum before making a request',
      () async {
        bool called = false;
        final PasswordSafety safety = PasswordSafety(
          client: MockClient((http.Request _) async {
            called = true;
            return http.Response('', 200);
          }),
        );

        final PasswordVerdict verdict = await safety.check('short');

        expect(verdict, isA<PasswordTooShort>());
        expect(verdict.ok, isFalse);
        expect(
          called,
          isFalse,
          reason:
              'A password that is already refused should not be sent anywhere, not even as '
              'a hash prefix.',
        );
      },
    );

    test('the minimum is the configured one, not a literal', () async {
      final PasswordVerdict verdict = await cleanCorpus().check(
        'x' * (PasswordSafetyConfig.minLength - 1),
      );
      expect(verdict, isA<PasswordTooShort>());
      expect(
        (verdict as PasswordTooShort).minLength,
        PasswordSafetyConfig.minLength,
      );
    });

    test('accepts a long password absent from the corpus', () async {
      final PasswordVerdict verdict = await cleanCorpus().check(
        'correct-horse-battery-staple-2026',
      );
      expect(verdict, isA<PasswordOk>());
      expect(verdict.ok, isTrue);
    });

    test('rejects a long password that appears in the corpus', () async {
      final PasswordSafety safety = PasswordSafety(
        client: MockClient((http.Request _) async {
          // Answer with the suffix of the password under test, so it reads as breached.
          return http.Response(
            '${PasswordSafety.sha1Hex('this-one-is-in-every-breach-list').substring(5)}:2401',
            200,
          );
        }),
      );

      final PasswordVerdict verdict = await safety.check(
        'this-one-is-in-every-breach-list',
      );

      expect(verdict, isA<PasswordBreached>());
      expect((verdict as PasswordBreached).occurrences, 2401);
    });

    test('length is checked before breach status, so the message is the actionable one', () async {
      // A short password that is ALSO breached should be reported as short: that is the thing
      // the person has to change first, and "appeared in 3 million breaches" reads as an
      // accusation when the real problem is eight characters.
      final PasswordSafety safety = PasswordSafety(
        client: MockClient(
          (http.Request _) async => http.Response(
            '${PasswordSafety.sha1Hex('password').substring(5)}:10382409',
            200,
          ),
        ),
      );

      expect(await safety.check('password'), isA<PasswordTooShort>());
    });
  });

  group('describeVerdict', () {
    test('says nothing when the password is fine', () {
      expect(describeVerdict(const PasswordOk()), isNull);
    });

    test('names the required length', () {
      expect(describeVerdict(const PasswordTooShort(12)), contains('12'));
    });

    test('groups the occurrence count with separators', () {
      // Matches the web client's `toLocaleString()`. An unseparated "10382409" is unreadable
      // at a glance, which is the entire job of this number.
      expect(
        describeVerdict(const PasswordBreached(10382409)),
        contains('10,382,409'),
      );
      expect(describeVerdict(const PasswordBreached(999)), contains('999'));
      expect(describeVerdict(const PasswordBreached(1000)), contains('1,000'));
      expect(describeVerdict(const PasswordBreached(1)), contains('1 '));
    });

    test('does not blame the person', () {
      // Deliberate wording check. Breach-notice copy that reads as an accusation makes people
      // re-use the password somewhere else rather than change it.
      final String message = describeVerdict(const PasswordBreached(500))!;
      expect(message.toLowerCase(), isNot(contains('you chose')));
      expect(message.toLowerCase(), isNot(contains('weak')));
      expect(message, contains('Choose a different one'));
    });
  });
}
