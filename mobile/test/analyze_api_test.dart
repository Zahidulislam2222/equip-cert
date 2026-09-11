/// `AnalyzeApi` — the boundary where an AI response becomes part of a safety record.
///
/// Two things are verified here, for different reasons.
///
/// `EquipmentAnalysis.fromJson` is the validation layer. Every field is checked rather than
/// cast, because the payload is produced by a language model and arrives AFTER the technician
/// has taken the photo — a `TypeError` at that point loses the expensive part of the work. The
/// tests below feed it the shapes a model actually emits when it goes wrong: nulls, numbers
/// where strings belong, a `safetyStatus` it invented, an `issues` list with junk in it.
///
/// `parseResponse` is the status-code mapping. It is exposed with `@visibleForTesting` because
/// `analyze()` returns early unless `AppInfo.apiBaseUrl` is non-empty, and that is a
/// compile-time `--dart-define` which CI's bare `flutter test` never sets. Without the
/// exposure this entire branch is unreachable from a test.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:equipcert_mobile/src/data/analyze_api.dart';
import 'package:equipcert_mobile/src/data/evidence_repository.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

/// A `SupabaseClient` that only knows how to answer `.auth`.
///
/// `noSuchMethod` throws rather than returning null so a test that accidentally depends on some
/// other part of the client fails loudly instead of passing for the wrong reason.
class _FakeSupabaseClient implements SupabaseClient {
  _FakeSupabaseClient(this._auth);

  final GoTrueClient _auth;

  @override
  GoTrueClient get auth => _auth;

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnsupportedError('unexpected call: ${invocation.memberName}');
}

class _FakeGoTrue implements GoTrueClient {
  _FakeGoTrue(this._session);

  final Session? _session;

  @override
  Session? get currentSession => _session;

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnsupportedError('unexpected call: ${invocation.memberName}');
}

Session _session() => Session(
  accessToken: 'test-access-token',
  tokenType: 'bearer',
  user: User(
    id: 'test-user-id',
    appMetadata: const <String, dynamic>{},
    userMetadata: const <String, dynamic>{},
    aud: 'authenticated',
    createdAt: '2026-01-01T00:00:00.000Z',
  ),
);

AnalyzeApi _api({Session? session}) =>
    AnalyzeApi(_FakeSupabaseClient(_FakeGoTrue(session)));

http.Response _json(Object? body, int status) =>
    http.Response(jsonEncode(body), status);

void main() {
  group('EquipmentAnalysis.fromJson — a well-formed response', () {
    final EquipmentAnalysis result = EquipmentAnalysis.fromJson(
      <String, Object?>{
        'equipmentName': 'CO2 Extinguisher 5kg',
        'serialNumber': 'SN-00421',
        'safetyStatus': 'Safe',
        'issues': <Object?>['Gauge slightly low'],
        'provenance': <String, Object?>{
          'aiAssisted': true,
          'provider': 'test-provider-one',
          'model': 'test-model-alpha',
          'disclosedAt': '2026-09-11T00:00:00Z',
        },
      },
    );

    test('it reads the equipment name', () {
      expect(result.equipmentName, 'CO2 Extinguisher 5kg');
    });

    test('it reads the serial number', () {
      expect(result.serialNumber, 'SN-00421');
    });

    test('it reads the safety status', () {
      expect(result.safetyStatus, 'Safe');
    });

    test('it reads the issues', () {
      expect(result.issues, <String>['Gauge slightly low']);
    });

    test('it reads the provenance', () {
      expect(result.provenance, isNotNull);
      expect(result.provenance!.provider, 'test-provider-one');
      expect(result.provenance!.model, 'test-model-alpha');
    });
  });

  group('EquipmentAnalysis.fromJson — malformed payloads must not throw', () {
    test('an empty object yields a usable result', () {
      final EquipmentAnalysis r = EquipmentAnalysis.fromJson(
        const <String, Object?>{},
      );
      expect(r.equipmentName, 'Unidentified equipment');
      expect(r.serialNumber, '');
      expect(r.issues, isEmpty);
      expect(r.provenance, isNull);
    });

    test('a null equipmentName falls back rather than throwing', () {
      expect(
        EquipmentAnalysis.fromJson(<String, Object?>{'equipmentName': null})
            .equipmentName,
        'Unidentified equipment',
      );
    });

    test('a numeric equipmentName falls back rather than casting', () {
      expect(
        EquipmentAnalysis.fromJson(<String, Object?>{'equipmentName': 42})
            .equipmentName,
        'Unidentified equipment',
      );
    });

    test('a whitespace-only equipmentName is treated as absent', () {
      expect(
        EquipmentAnalysis.fromJson(<String, Object?>{'equipmentName': '   '})
            .equipmentName,
        'Unidentified equipment',
      );
    });

    test('a name with surrounding whitespace is trimmed', () {
      expect(
        EquipmentAnalysis.fromJson(<String, Object?>{
          'equipmentName': '  Dry Powder 9kg  ',
        }).equipmentName,
        'Dry Powder 9kg',
      );
    });

    test('a whitespace-only serial number becomes empty, not whitespace', () {
      expect(
        EquipmentAnalysis.fromJson(<String, Object?>{'serialNumber': '  '})
            .serialNumber,
        '',
      );
    });
  });

  group('safetyStatus — the failure-safe direction', () {
    test('"Safe" is preserved', () {
      expect(
        EquipmentAnalysis.fromJson(<String, Object?>{'safetyStatus': 'Safe'})
            .safetyStatus,
        'Safe',
      );
    });

    test('"Action Required" is preserved', () {
      expect(
        EquipmentAnalysis.fromJson(<String, Object?>{
          'safetyStatus': 'Action Required',
        }).safetyStatus,
        'Action Required',
      );
    });

    test('an invented third category degrades to Action Required', () {
      expect(
        EquipmentAnalysis.fromJson(<String, Object?>{
          'safetyStatus': 'Probably Fine',
        }).safetyStatus,
        'Action Required',
      );
    });

    test('an absent status degrades to Action Required', () {
      expect(
        EquipmentAnalysis.fromJson(const <String, Object?>{}).safetyStatus,
        'Action Required',
      );
    });

    test('lowercase "safe" does NOT count as Safe', () {
      // The `inspections.status` CHECK constraint is exact. A near miss must degrade to the
      // cautious value rather than be helpfully normalised into a pass.
      expect(
        EquipmentAnalysis.fromJson(<String, Object?>{'safetyStatus': 'safe'})
            .safetyStatus,
        'Action Required',
      );
    });

    test('a boolean true does not become Safe', () {
      expect(
        EquipmentAnalysis.fromJson(<String, Object?>{'safetyStatus': true})
            .safetyStatus,
        'Action Required',
      );
    });
  });

  group('issues — junk is filtered, not propagated onto the record', () {
    test('non-string members are dropped', () {
      expect(
        EquipmentAnalysis.fromJson(<String, Object?>{
          'issues': <Object?>[
            'real issue',
            7,
            null,
            <String>['nested'],
          ],
        }).issues,
        <String>['real issue'],
      );
    });

    test('empty and whitespace-only strings are dropped', () {
      expect(
        EquipmentAnalysis.fromJson(<String, Object?>{
          'issues': <Object?>['', '   ', 'kept'],
        }).issues,
        <String>['kept'],
      );
    });

    test('a non-list issues field yields an empty list', () {
      expect(
        EquipmentAnalysis.fromJson(<String, Object?>{'issues': 'not a list'})
            .issues,
        isEmpty,
      );
    });
  });

  group('provenance — never claim an AI ran unless the server said so', () {
    test('a response with no provenance records no AI claim', () {
      expect(
        EquipmentAnalysis.fromJson(const <String, Object?>{}).provenance,
        isNull,
      );
    });

    test('aiAssisted:false yields no claim', () {
      expect(
        EquipmentAnalysis.fromJson(<String, Object?>{
          'provenance': <String, Object?>{
            'aiAssisted': false,
            'provider': 'test-provider-one',
            'model': 'test-model-alpha',
            'disclosedAt': '2026-09-11T00:00:00Z',
          },
        }).provenance,
        isNull,
      );
    });

    test('the STRING "true" is not an assertion of AI involvement', () {
      expect(
        EquipmentAnalysis.fromJson(<String, Object?>{
          'provenance': <String, Object?>{
            'aiAssisted': 'true',
            'provider': 'test-provider-one',
            'model': 'test-model-alpha',
            'disclosedAt': '2026-09-11T00:00:00Z',
          },
        }).provenance,
        isNull,
      );
    });

    test('a provenance missing its model is rejected whole', () {
      // A partial record is worse than none: it would put an unverifiable claim onto a
      // safety document.
      expect(
        EquipmentAnalysis.fromJson(<String, Object?>{
          'provenance': <String, Object?>{
            'aiAssisted': true,
            'provider': 'test-provider-one',
            'disclosedAt': '2026-09-11T00:00:00Z',
          },
        }).provenance,
        isNull,
      );
    });
  });

  group('parseResponse — HTTP status becomes an instruction, not a code', () {
    final AnalyzeApi api = _api(session: _session());

    test('200 with a valid body parses', () {
      final EquipmentAnalysis r = api.parseResponse(
        _json(<String, Object?>{'equipmentName': 'Foam 6L'}, 200),
      );
      expect(r.equipmentName, 'Foam 6L');
    });

    test('200 with a JSON array is rejected as unreadable', () {
      expect(
        () => api.parseResponse(_json(<Object?>['not', 'an', 'object'], 200)),
        throwsA(isA<AnalyzeException>()),
      );
    });

    test('200 with non-JSON throws rather than returning junk', () {
      expect(
        () => api.parseResponse(http.Response('<html>502</html>', 200)),
        throwsA(anything),
      );
    });

    test('401 is not retryable — retrying cannot fix an expired session', () {
      try {
        api.parseResponse(_json(const <String, Object?>{}, 401));
        fail('expected an AnalyzeException');
      } on AnalyzeException catch (e) {
        expect(e.retryable, isFalse);
        expect(e.message, contains('Sign in again'));
      }
    });

    test('429 IS retryable — the limit is a matter of waiting', () {
      try {
        api.parseResponse(_json(const <String, Object?>{}, 429));
        fail('expected an AnalyzeException');
      } on AnalyzeException catch (e) {
        expect(e.retryable, isTrue);
      }
    });

    test('400 tells the technician to change the photo', () {
      try {
        api.parseResponse(_json(const <String, Object?>{}, 400));
        fail('expected an AnalyzeException');
      } on AnalyzeException catch (e) {
        expect(e.message.toLowerCase(), contains('photo'));
      }
    });

    for (final int status in <int>[500, 503]) {
      test('$status offers the manual path', () {
        try {
          api.parseResponse(_json(const <String, Object?>{}, status));
          fail('expected an AnalyzeException');
        } on AnalyzeException catch (e) {
          expect(e.message.toLowerCase(), contains('manually'));
        }
      });
    }

    test('an unmapped status still produces an explainable failure', () {
      try {
        api.parseResponse(_json(const <String, Object?>{}, 418));
        fail('expected an AnalyzeException');
      } on AnalyzeException catch (e) {
        expect(e.message, isNotEmpty);
        expect(e.message.toLowerCase(), contains('manually'));
      }
    });

    test('no mapped error leaks a status code at the technician', () {
      for (final int status in <int>[401, 429, 400, 500, 503, 418]) {
        try {
          api.parseResponse(_json(const <String, Object?>{}, status));
          fail('expected an AnalyzeException for $status');
        } on AnalyzeException catch (e) {
          expect(e.message, isNot(contains('$status')));
          expect(e.message.trim(), isNotEmpty);
        }
      }
    });
  });

  group('guards that run before any request is made', () {
    test('an unconfigured build fails closed and is not retryable', () async {
      // CI runs `flutter test` with no --dart-define, so apiBaseUrl is empty here. That is
      // exactly the released-build-without-config case this guard exists for.
      final AnalyzeApi api = _api(session: _session());
      expect(api.isConfigured, isFalse);
      try {
        await api.analyze(image: Uint8List(0), format: EvidenceFormat.jpeg);
        fail('expected an AnalyzeException');
      } on AnalyzeException catch (e) {
        expect(e.retryable, isFalse);
        expect(e.message.toLowerCase(), contains('manually'));
      }
    });
  });

  group('AnalyzeException', () {
    test('it is retryable by default', () {
      expect(const AnalyzeException('x').retryable, isTrue);
    });

    test('toString is the message, so a UI can show it directly', () {
      expect(
        const AnalyzeException('Could not reach it').toString(),
        'Could not reach it',
      );
    });
  });
}
