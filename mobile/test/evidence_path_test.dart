/// Where an uploaded photo or signature actually lands — acceptance criterion C3.
///
/// ---------------------------------------------------------------------------------------
/// WHY THE SHAPE OF A STRING IS A SECURITY CONTROL
///
/// DEF-017: evidence once went into a PUBLIC bucket under a filename that was only a
/// millisecond timestamp. Two independent failures in one path — anyone could read it without
/// authenticating, and the address of somebody else's photo could be *guessed* by trying
/// nearby milliseconds.
///
/// The fix is the path itself:
///
///     <organizationId>/<kind>/<uuid>.<ext>
///
///   * segment 1 is the tenant, because the RLS policy is literally
///     `(storage.foldername(object_name))[1] = app.current_org_id()`. Get this segment wrong
///     and the policy either rejects every upload or — far worse — scopes it to the wrong org.
///   * segment 3 is a random UUID, so an address cannot be derived from a clock.
///
/// ---------------------------------------------------------------------------------------
/// WHY THIS TEST READS OTHER FILES INSTEAD OF RESTATING THE CONTRACT
///
/// The path shape is a contract between THREE owners: this Dart client, the web client's
/// `src/lib/evidence.ts`, and the RLS policy in `20260910000300_storage.sql`. A test that
/// hardcoded the expected string would be a fourth copy — it would keep passing on the day one
/// of the other three changed, which is precisely the day it needed to fail.
///
/// So the expectations are PARSED from the files that own them, the same way
/// `schema_contract_test.dart` reads the migrations.
library;

import 'dart:io';

import 'package:equipcert_mobile/src/config/app_config.dart';
import 'package:equipcert_mobile/src/data/evidence_repository.dart';
import 'package:flutter_test/flutter_test.dart';

String _read(String relativePath) {
  final File file = File(relativePath);
  expect(
    file.existsSync(),
    isTrue,
    reason:
        'expected $relativePath relative to mobile/. This test asserts a cross-client '
        'contract and is worthless if it silently skips the other side of it.',
  );
  return file.readAsStringSync();
}

void main() {
  const String orgId = 'org-test-0001';
  const String uuid = '00000000-0000-4000-8000-000000000000';

  group('the path shape itself', () {
    test('it is org / kind / uuid.ext, in that order', () {
      expect(
        EvidenceConfig.objectPath(
          organizationId: orgId,
          kind: 'inspection',
          id: uuid,
          extension: 'jpg',
        ),
        '$orgId/inspection/$uuid.jpg',
      );
    });

    test(
      'the FIRST segment is the organisation — the RLS policy indexes [1]',
      () {
        // `(storage.foldername(name))[1]` is 1-indexed in Postgres. If the org were second, the
        // policy would compare a literal like "inspection" against the org id and every upload
        // would be rejected — or, if some other value happened to sit there, scoped wrongly.
        final String path = EvidenceConfig.objectPath(
          organizationId: orgId,
          kind: 'signature',
          id: uuid,
          extension: 'png',
        );

        expect(path.split('/').first, orgId);
      },
    );

    test('it has exactly three segments', () {
      final String path = EvidenceConfig.objectPath(
        organizationId: orgId,
        kind: 'corrective',
        id: uuid,
        extension: 'webp',
      );

      expect(path.split('/').length, 3);
    });

    test('it does not start with a slash', () {
      // A leading slash makes the first `foldername` segment the empty string, which no policy
      // matches, and the upload fails with an opaque 400.
      expect(
        EvidenceConfig.objectPath(
          organizationId: orgId,
          kind: 'inspection',
          id: uuid,
          extension: 'jpg',
        ),
        isNot(startsWith('/')),
      );
    });

    test('it is a bucket-relative path, never a URL — DEF-017', () {
      final String path = EvidenceConfig.objectPath(
        organizationId: orgId,
        kind: 'inspection',
        id: uuid,
        extension: 'jpg',
      );

      expect(path, isNot(contains('://')));
      expect(path, isNot(contains('supabase')));
      expect(path, isNot(contains('storage/v1')));
    });

    test('the extension is separated by a dot, not a slash', () {
      final String path = EvidenceConfig.objectPath(
        organizationId: orgId,
        kind: 'inspection',
        id: uuid,
        extension: 'jpg',
      );

      expect(path.split('/').last, '$uuid.jpg');
    });

    test('two calls with different ids produce different paths', () {
      // The address must come from the id, not from a clock — the guessability half of
      // DEF-017.
      final String a = EvidenceConfig.objectPath(
        organizationId: orgId,
        kind: 'inspection',
        id: '11111111-1111-4111-8111-111111111111',
        extension: 'jpg',
      );
      final String b = EvidenceConfig.objectPath(
        organizationId: orgId,
        kind: 'inspection',
        id: '22222222-2222-4222-8222-222222222222',
        extension: 'jpg',
      );

      expect(a, isNot(b));
    });

    test('different orgs never share a prefix segment', () {
      final String a = EvidenceConfig.objectPath(
        organizationId: 'org-test-aaaa',
        kind: 'inspection',
        id: uuid,
        extension: 'jpg',
      );
      final String b = EvidenceConfig.objectPath(
        organizationId: 'org-test-bbbb',
        kind: 'inspection',
        id: uuid,
        extension: 'jpg',
      );

      expect(a.split('/').first, isNot(b.split('/').first));
    });
  });

  group('every EvidenceKind produces a usable segment', () {
    for (final EvidenceKind kind in EvidenceKind.values) {
      test('${kind.name} yields a clean middle segment', () {
        final String path = EvidenceConfig.objectPath(
          organizationId: orgId,
          kind: kind.wire,
          id: uuid,
          extension: 'jpg',
        );

        expect(path.split('/')[1], kind.wire);
        // A slash or a dot in the kind would silently change the segment count and break the
        // policy's [1] index.
        expect(kind.wire, isNot(contains('/')));
        expect(kind.wire, isNot(contains('.')));
        expect(kind.wire, isNotEmpty);
      });
    }

    test('wire is the enum name, so the two cannot drift apart', () {
      for (final EvidenceKind kind in EvidenceKind.values) {
        expect(kind.wire, kind.name);
      }
    });
  });

  group(
    'C3: the Dart client agrees with the web client (src/lib/evidence.ts)',
    () {
      late String ts;

      setUpAll(() => ts = _read('../src/lib/evidence.ts'));

      test('the bucket name is the same on both clients', () {
        final RegExpMatch? match = RegExp(r"EVIDENCE_BUCKET\s*=\s*'([^']+)'")
            .firstMatch(ts);
        expect(
          match,
          isNotNull,
          reason: 'EVIDENCE_BUCKET not found in src/lib/evidence.ts',
        );

        expect(EvidenceConfig.bucket, match!.group(1));
      });

      test('the web builds the identical template', () {
        // The literal in evidence.ts is
        //   `${organizationId}/${kind}/${crypto.randomUUID()}.${extension}`
        // Normalising both sides to `<a>/<b>/<c>.<d>` compares the SHAPE rather than the syntax
        // of two different languages.
        final RegExpMatch? match = RegExp(r'const path = `([^`]+)`')
            .firstMatch(ts);
        expect(
          match,
          isNotNull,
          reason: 'the path template was not found in evidence.ts',
        );

        final String webShape = match!
            .group(1)!
            .replaceAll(RegExp(r'\$\{[^}]+\}'), '<>');
        final String dartShape = EvidenceConfig.objectPath(
          organizationId: '<>',
          kind: '<>',
          id: '<>',
          extension: '<>',
        );

        expect(dartShape, webShape);
      });

      test('both clients recognise the same set of kinds', () {
        final RegExpMatch? match = RegExp(
          r'export type EvidenceKind\s*=\s*([^;]+);',
        ).firstMatch(ts);
        expect(
          match,
          isNotNull,
          reason: 'EvidenceKind union not found in evidence.ts',
        );

        final Set<String> webKinds = RegExp("'([^']+)'")
            .allMatches(match!.group(1)!)
            .map((RegExpMatch m) => m.group(1)!)
            .toSet();

        expect(
          EvidenceKind.values.map((EvidenceKind k) => k.wire).toSet(),
          webKinds,
          reason:
              'a kind on one client and not the other uploads into a folder the other '
              'never looks in',
        );
      });
    },
  );

  group('C3: the Dart client agrees with the storage migration', () {
    late String sql;

    setUpAll(
      () => sql = _read('../supabase/migrations/20260910000300_storage.sql'),
    );

    test(
      'the bucket the client writes to is the one the migration creates',
      () {
        expect(sql, contains("'${EvidenceConfig.bucket}'"));
      },
    );

    test('that bucket is PRIVATE — the first half of DEF-017', () {
      // `public = false` in the INSERT. If this ever flips, every signed-URL control in the
      // app becomes decoration.
      final RegExpMatch? insert = RegExp(
        r'INSERT INTO storage\.buckets[^;]+;',
        caseSensitive: false,
      ).firstMatch(sql);
      expect(insert, isNotNull, reason: 'the bucket INSERT was not found');

      expect(insert!.group(0), contains('false'));
      expect(
        RegExp(r'\btrue\b').hasMatch(insert.group(0)!),
        isFalse,
        reason: 'the evidence bucket must not be public',
      );
    });

    test('the RLS policy scopes on the first path segment', () {
      // This is what makes segment 1 load-bearing rather than cosmetic.
      expect(sql, contains('foldername'));
      expect(sql, contains('[1]'));
    });

    test('every format the client can produce is allowed by the bucket', () {
      final RegExpMatch? match = RegExp(
        r'allowed_mime_types[^;]*?ARRAY\[([^\]]+)\]',
        dotAll: true,
      ).firstMatch(sql);
      expect(
        match,
        isNotNull,
        reason: 'allowed_mime_types ARRAY not found in the migration',
      );

      final Set<String> allowed = RegExp("'([^']+)'")
          .allMatches(match!.group(1)!)
          .map((RegExpMatch m) => m.group(1)!)
          .toSet();

      for (final EvidenceFormat format in EvidenceFormat.values) {
        expect(
          allowed,
          contains(format.mimeType),
          reason:
              '${format.name} would be rejected with a generic 400 naming neither the '
              'type nor the constraint',
        );
      }
    });

    test('the capture downscale stays under the bucket size limit', () {
      final RegExpMatch? match = RegExp(
        r'^\s*(\d{6,}),\s*--',
        multiLine: true,
      ).firstMatch(sql);
      expect(
        match,
        isNotNull,
        reason: 'file_size_limit not found in the migration',
      );

      // Not a byte-for-byte assertion on a compressed image — just that the cap is a real,
      // non-trivial number the client has a chance of meeting. The byte-level check lives in
      // capture_downscale_test.dart against the analyze endpoint's own cap.
      expect(int.parse(match!.group(1)!), greaterThan(1024 * 1024));
    });
  });

  group('EvidenceFormat is self-consistent', () {
    test('every mime type round-trips through fromMimeType', () {
      for (final EvidenceFormat format in EvidenceFormat.values) {
        expect(EvidenceFormat.fromMimeType(format.mimeType), format);
      }
    });

    test('an unknown mime type returns null rather than a default', () {
      // Defaulting to jpeg would label a file as something it is not, and the bucket would
      // reject it on a header the client claimed.
      expect(EvidenceFormat.fromMimeType('image/heic'), isNull);
      expect(EvidenceFormat.fromMimeType(''), isNull);
      expect(EvidenceFormat.fromMimeType('application/pdf'), isNull);
    });

    test('no extension carries a leading dot', () {
      // `objectPath` supplies the dot. An extension of '.jpg' would produce `uuid..jpg`.
      for (final EvidenceFormat format in EvidenceFormat.values) {
        expect(format.extension, isNot(startsWith('.')));
      }
    });

    test('extensions are unique, so a path implies exactly one format', () {
      final Set<String> extensions = EvidenceFormat.values
          .map((EvidenceFormat f) => f.extension)
          .toSet();

      expect(extensions.length, EvidenceFormat.values.length);
    });
  });
}
