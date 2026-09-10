/// EU AI Act Art. 50(1) provenance: what the client will and will not accept as an AI claim.
///
/// ---------------------------------------------------------------------------------------
/// WHAT IS ACTUALLY AT RISK
///
/// `AiProvenance.tryParse` sits between a network response and four columns on a permanent
/// compliance record. It can fail in two directions and they are not symmetric:
///
///   * **Under-claiming** — dropping a valid provenance — loses a disclosure on a record that
///     had AI involvement. Bad, and visible: the disclosure widget renders nothing.
///   * **Over-claiming** — accepting something that is not an AI assertion — puts an
///     unverifiable statement about a named provider and model onto a safety document, and
///     it is invisible, because the record looks exactly like a legitimate one.
///
/// So every test here pushes on the second direction. The specific hazard is `'false'`: the
/// string is truthy under a loose check, so `if (value['aiAssisted'])` in a dynamically typed
/// payload flips a negative into a positive claim. The implementation compares against `true`
/// by identity for that reason, and this file is what stops someone "simplifying" it back.
library;

import 'package:equipcert_mobile/src/compliance/ai_provenance.dart';
import 'package:flutter_test/flutter_test.dart';

const Map<String, Object?> _valid = <String, Object?>{
  'aiAssisted': true,
  'provider': 'test-provider-one',
  'model': 'test-model-alpha',
  'disclosedAt': '2026-09-11T09:15:00.000Z',
};

void main() {
  group('tryParse accepts a complete server assertion', () {
    test('returns every field exactly as sent', () {
      final AiProvenance? parsed = AiProvenance.tryParse(_valid);

      expect(parsed, isNotNull);
      expect(parsed!.provider, 'test-provider-one');
      expect(parsed.model, 'test-model-alpha');
      expect(parsed.disclosedAt, '2026-09-11T09:15:00.000Z');
    });

    test('does not reformat the timestamp', () {
      // The disclosure time is evidence. Reformatting it on a device whose clock, locale and
      // time zone are all unverified degrades the record — so whatever the server said is
      // what gets stored, byte for byte.
      const String odd = '2026-09-11T09:15:00+05:30';
      final AiProvenance? parsed = AiProvenance.tryParse(<String, Object?>{
        ..._valid,
        'disclosedAt': odd,
      });

      expect(parsed?.disclosedAt, odd);
    });

    test(
      'ignores unknown extra fields rather than rejecting the whole payload',
      () {
        final AiProvenance? parsed = AiProvenance.tryParse(<String, Object?>{
          ..._valid,
          'latencyMs': 812,
          'someFutureField': <String, Object?>{'a': 1},
        });

        expect(parsed?.model, 'test-model-alpha');
      },
    );
  });

  group('tryParse refuses to manufacture an AI claim', () {
    test(
      "the STRING 'false' is not an assertion — the case this guard exists for",
      () {
        expect(
          AiProvenance.tryParse(<String, Object?>{
            ..._valid,
            'aiAssisted': 'false',
          }),
          isNull,
        );
      },
    );

    test("the STRING 'true' is not an assertion either", () {
      // Equally important. Accepting it would mean the type of the field decides whether a
      // legal disclosure is recorded, and a JSON serialiser change could start or stop the
      // claim without anyone touching this code.
      expect(
        AiProvenance.tryParse(<String, Object?>{
          ..._valid,
          'aiAssisted': 'true',
        }),
        isNull,
      );
    });

    test('the number 1 is not an assertion', () {
      expect(
        AiProvenance.tryParse(<String, Object?>{..._valid, 'aiAssisted': 1}),
        isNull,
      );
    });

    test('explicit false, absent, and null all mean no AI', () {
      expect(
        AiProvenance.tryParse(<String, Object?>{
          ..._valid,
          'aiAssisted': false,
        }),
        isNull,
      );
      expect(
        AiProvenance.tryParse(<String, Object?>{..._valid, 'aiAssisted': null}),
        isNull,
      );

      final Map<String, Object?> absent = Map<String, Object?>.of(_valid)
        ..remove('aiAssisted');
      expect(AiProvenance.tryParse(absent), isNull);
    });

    test('a claim with no provider is refused', () {
      final Map<String, Object?> missing = Map<String, Object?>.of(_valid)
        ..remove('provider');
      expect(AiProvenance.tryParse(missing), isNull);
    });

    test('an empty provider or model is refused, not stored as a blank', () {
      expect(
        AiProvenance.tryParse(<String, Object?>{..._valid, 'provider': ''}),
        isNull,
      );
      expect(
        AiProvenance.tryParse(<String, Object?>{..._valid, 'model': ''}),
        isNull,
      );
    });

    test(
      'a non-string provider or model is refused rather than stringified',
      () {
        expect(
          AiProvenance.tryParse(<String, Object?>{..._valid, 'provider': 7}),
          isNull,
        );
        expect(
          AiProvenance.tryParse(<String, Object?>{
            ..._valid,
            'model': <String>['a'],
          }),
          isNull,
        );
      },
    );

    test('a missing or empty disclosure time is refused', () {
      final Map<String, Object?> missing = Map<String, Object?>.of(_valid)
        ..remove('disclosedAt');
      expect(AiProvenance.tryParse(missing), isNull);
      expect(
        AiProvenance.tryParse(<String, Object?>{..._valid, 'disclosedAt': ''}),
        isNull,
      );
    });
  });

  group('tryParse survives a payload that is not the shape it expects', () {
    test('null, a string, a number, a list and a bool all return null, never throw', () {
      // This runs on the submit path. A malformed response must not take an inspection down
      // with it — the technician has already left the plant room.
      for (final Object? value in <Object?>[null, 'x', 3, <Object?>[], true]) {
        expect(AiProvenance.tryParse(value), isNull);
      }
    });

    test('a dynamically typed map — what jsonDecode actually returns — is accepted', () {
      // `jsonDecode` produces Map<String, dynamic>, not Map<String, Object?>. The `is! Map`
      // check is deliberately unparameterised so that this works.
      final Map<String, dynamic> decoded = <String, dynamic>{
        'aiAssisted': true,
        'provider': 'test-provider-two',
        'model': 'test-model-beta',
        'disclosedAt': '2026-09-11T00:00:00.000Z',
      };

      expect(AiProvenance.tryParse(decoded)?.provider, 'test-provider-two');
    });
  });

  group('toColumns writes all four columns or none', () {
    test('a null provenance is the honest "no AI was involved" row', () {
      final Map<String, Object?> columns = AiProvenance.toColumns(null);

      expect(columns['ai_assisted'], false);
      expect(columns['ai_provider'], isNull);
      expect(columns['ai_model'], isNull);
      expect(columns['ai_disclosed_at'], isNull);
    });

    test('a present provenance fills every column', () {
      final Map<String, Object?> columns = AiProvenance.toColumns(
        AiProvenance.tryParse(_valid),
      );

      expect(columns['ai_assisted'], true);
      expect(columns['ai_provider'], 'test-provider-one');
      expect(columns['ai_model'], 'test-model-alpha');
      expect(columns['ai_disclosed_at'], '2026-09-11T09:15:00.000Z');
    });

    test('both branches emit the SAME four keys — the ai_provenance_is_complete contract', () {
      // The database rejects a partial set. If one branch ever stopped emitting a key, the
      // insert would fail at submit time, after the photo was uploaded and the signature
      // taken. Comparing key sets catches that here instead.
      expect(
        AiProvenance.toColumns(null).keys.toSet(),
        AiProvenance.toColumns(AiProvenance.tryParse(_valid)).keys.toSet(),
      );
    });

    test('ai_assisted is a real bool in both branches, never a string', () {
      expect(AiProvenance.toColumns(null)['ai_assisted'], isA<bool>());
      expect(
        AiProvenance.toColumns(AiProvenance.tryParse(_valid))['ai_assisted'],
        isA<bool>(),
      );
    });
  });

  group('value equality', () {
    test('two provenances parsed from the same payload are equal', () {
      expect(AiProvenance.tryParse(_valid), AiProvenance.tryParse(_valid));
      expect(
        AiProvenance.tryParse(_valid).hashCode,
        AiProvenance.tryParse(_valid).hashCode,
      );
    });

    test('a different model is a different provenance', () {
      expect(
        AiProvenance.tryParse(_valid),
        isNot(
          AiProvenance.tryParse(<String, Object?>{
            ..._valid,
            'model': 'test-model-gamma',
          }),
        ),
      );
    });
  });
}
