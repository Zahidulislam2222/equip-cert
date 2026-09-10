/// `slugify` against the CHECK constraint it has to satisfy.
///
/// ---------------------------------------------------------------------------------------
/// THE CONSTRAINT IS THE SPEC
///
/// ```sql
/// slug TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$')
/// ```
///
/// Read literally, that pattern says: lowercase alphanumerics and hyphens, may not START or
/// END with a hyphen, at least 1 and at most 63 characters. The web client's version —
/// `name.toLowerCase().replace(/[^a-z0-9]+/g, '-')` — violates it for a large share of real
/// company names, because trailing punctuation is the COMMON case, not the edge case:
///
///     "Acme Ltd."          -> "acme-ltd-"      trailing hyphen, REJECTED
///     "  Acme  "           -> "-acme-"         both ends, REJECTED
///     "洪水"                -> ""               empty, REJECTED
///
/// Each of those is an opaque 23514 constraint violation during signup with no message the
/// person can act on. So the pattern below is not a copy of the implementation's regex; it is
/// transcribed from the migration, and every case asserts against it directly. If `slugify`
/// and the database ever disagree, this fails on the side the database is on.
library;

import 'dart:io';

import 'package:equipcert_mobile/src/auth/auth_repository.dart';
import 'package:equipcert_mobile/src/util/uuid.dart';
import 'package:flutter_test/flutter_test.dart';

/// Transcribed from `supabase/migrations/20260910000100_core_schema.sql`.
final RegExp slugCheck = RegExp(r'^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$');

void main() {
  group('the constraint this test asserts against is the real one', () {
    // Guards against the transcription itself drifting. If someone relaxes the column, this
    // test starts passing things the database would reject unless it is updated too.
    test('the migration still declares the pattern used here', () {
      final File schema = File(
        '../supabase/migrations/20260910000100_core_schema.sql',
      );
      expect(
        schema.existsSync(),
        isTrue,
        reason: 'Expected ${schema.absolute.path}',
      );

      final String sql = schema.readAsStringSync();
      expect(
        sql.replaceAll(RegExp(r'\s+'), ' '),
        contains(r"slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'"),
        reason:
            'The slug CHECK constraint changed. Update `slugCheck` in this file to match '
            'it, then re-run — do not relax the test to make it pass.',
      );
    });
  });

  group('names that broke the web implementation', () {
    // Every one of these produces a slug the CHECK rejects under
    // `.replace(/[^a-z0-9]+/g, '-')`.
    const Map<String, String> cases = <String, String>{
      'Acme Ltd.': 'acme-ltd',
      'Acme, Inc.': 'acme-inc',
      'Smith & Sons!': 'smith-sons',
      '  Padded Name  ': 'padded-name',
      '---Leading Hyphens': 'leading-hyphens',
      'Trailing Hyphens---': 'trailing-hyphens',
      'Multiple    Spaces': 'multiple-spaces',
      "O'Brien Fire Safety": 'o-brien-fire-safety',
      'Fire & Rescue (UK) Ltd.': 'fire-rescue-uk-ltd',
      'ACME FIRE': 'acme-fire',
      'Ünïcödé Gmbh': 'n-c-d-gmbh',
    };

    cases.forEach((String input, String expected) {
      test('"$input" -> "$expected"', () {
        final String slug = slugify(input);
        expect(slug, expected);
        expect(
          slug,
          matches(slugCheck),
          reason:
              'The database would reject "$slug" with a 23514 the user cannot act on.',
        );
      });
    });
  });

  group('names with no alphanumeric content', () {
    // These slugify to nothing. `organizations.name` accepts them — its CHECK only requires
    // 1..200 non-blank characters — so refusing the company outright is not an option. The
    // contract is that `slugify` returns EMPTY and the caller substitutes a generated slug.
    for (final String input in <String>[
      '洪水',
      '!!!',
      '   ',
      '---',
      '@#\$%',
      '。、',
    ]) {
      test('"$input" slugifies to empty rather than to something invalid', () {
        final String slug = slugify(input);
        expect(
          slug,
          isEmpty,
          reason:
              'Returning "$slug" here would be worse than returning empty: the caller '
              'checks for empty to know it must generate one.',
        );
      });
    }
  });

  group('length', () {
    test('a 63-character result is left alone', () {
      final String name = 'a' * 63;
      expect(slugify(name), hasLength(63));
      expect(slugify(name), matches(slugCheck));
    });

    test('an over-long name is truncated to the 63-character ceiling', () {
      final String slug = slugify('Extremely Long Company Name ${'x' * 200}');
      expect(slug.length, lessThanOrEqualTo(63));
      expect(slug, matches(slugCheck));
    });

    test('truncation never leaves a trailing hyphen', () {
      // The nasty case: cutting at exactly 63 characters can land on a hyphen, producing a
      // slug that is the right LENGTH and still fails the pattern. Sweep a range of names so
      // the cut lands on a separator for some of them.
      for (int words = 1; words <= 40; words++) {
        final String name = List<String>.filled(words, 'word').join(' ');
        final String slug = slugify(name);
        if (slug.isEmpty) continue;
        expect(
          slug,
          matches(slugCheck),
          reason: 'slugify("$name") produced "$slug", which the CHECK rejects.',
        );
      }
    });

    test('a name of hyphens and one letter still yields a valid slug', () {
      expect(slugify('----a----'), 'a');
      expect(slugify('----a----'), matches(slugCheck));
    });
  });

  group('property: any name either slugifies to empty or to something the CHECK accepts', () {
    // There is no third outcome, and this is the only assertion that matters. The specific
    // cases above document known failures; this one covers what nobody thought of.
    test('across a broad spread of inputs', () {
      final List<String> corpus = <String>[
        'Acme',
        'Acme Ltd.',
        '123 Fire',
        '9',
        '-',
        '--',
        'a-b',
        'a--b',
        'A' * 100,
        '${'-' * 30}z',
        'z${'-' * 30}',
        'Ünïcödé',
        '洪水 Fire Safety',
        'Fire\tSafety\nLtd',
        'Fire/Safety\\Ltd',
        '  ',
        '',
        '.',
        'e.on',
        '3M',
        'AT&T',
        'Müller & Söhne GmbH & Co. KG',
      ];

      for (final String name in corpus) {
        final String slug = slugify(name);
        if (slug.isEmpty) continue;
        expect(
          slug,
          matches(slugCheck),
          reason:
              'slugify("$name") produced "$slug", which violates the slug CHECK.',
        );
      }
    });
  });

  group('collision fallback', () {
    // "Acme Fire Safety" is not a rare name. The second tenant to sign up with it gets a
    // 23505, and the retry appends a token — which must itself still satisfy the pattern,
    // INCLUDING when the base was already at the length ceiling.
    test(
      'shortToken is lowercase alphanumeric, so it cannot break the pattern',
      () {
        for (int i = 0; i < 200; i++) {
          final String token = shortToken();
          expect(token, matches(RegExp(r'^[a-z0-9]+$')));
          expect(token, hasLength(6));
        }
      },
    );

    test('base + token stays inside 63 characters and stays valid', () {
      // Mirrors what `_insertOrganization` builds on a retry.
      for (final String name in <String>['Acme', 'A' * 200, 'Word ' * 30]) {
        final String base = slugify(name);
        if (base.isEmpty) continue;

        final String trimmed = base.length <= 56
            ? base
            : base.substring(0, 56).replaceAll(RegExp(r'-+$'), '');
        final String retry = '$trimmed-${shortToken()}';

        expect(retry.length, lessThanOrEqualTo(63));
        expect(
          retry,
          matches(slugCheck),
          reason:
              'The retry slug "$retry" would be rejected, so a name collision would be '
              'an unrecoverable signup rather than a retry.',
        );
      }
    });

    test('shortToken does not repeat over a large sample', () {
      // Not a uniqueness guarantee — it is 6 characters from a 36-symbol alphabet. This
      // asserts the generator is actually random rather than returning a constant, which is
      // the failure that would make the retry loop useless.
      final Set<String> seen = <String>{};
      for (int i = 0; i < 500; i++) {
        seen.add(shortToken());
      }
      expect(seen.length, greaterThan(490));
    });
  });

  group('uuidV4', () {
    test('is canonical 8-4-4-4-12 lowercase hex', () {
      for (int i = 0; i < 100; i++) {
        expect(
          uuidV4(),
          matches(
            RegExp(
              r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
            ),
          ),
        );
      }
    });

    test('sets the version-4 and variant-1 bits', () {
      // Postgres `uuid` will accept almost anything hex-shaped, so a malformed version nibble
      // would never be caught by the database. It would just be a non-conforming identifier
      // sitting in a compliance record forever.
      for (int i = 0; i < 100; i++) {
        final String id = uuidV4();
        expect(id[14], '4', reason: 'version nibble in "$id"');
        expect('89ab', contains(id[19]), reason: 'variant nibble in "$id"');
      }
    });

    test('does not repeat', () {
      // These become evidence object paths. A repeat would be an upload collision against
      // `upsert: false` — and, worse, two inspections addressing the same file.
      final Set<String> seen = <String>{};
      for (int i = 0; i < 2000; i++) {
        seen.add(uuidV4());
      }
      expect(seen, hasLength(2000));
    });
  });
}
