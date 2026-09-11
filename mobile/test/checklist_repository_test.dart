/// `ChecklistRepository` — the class whose whole reason for existing is a non-empty list.
///
/// The web client fetches this checklist from Contentful and, on failure, leaves the list
/// EMPTY. That is not a degraded inspection; it is a screen with nothing to answer and a submit
/// button that files a compliance record asserting nothing was checked. This client falls back
/// to the NFPA 10 monthly points instead.
///
/// So the invariant under test is blunt: **no input produces an empty checklist, and no input
/// throws.** Most of the tests below exist to attack that one sentence with malformed payloads.
///
/// `parseResponse` is exercised directly. `forEquipment` reaches it only when
/// `ContentfulConfig.isConfigured` is true, and that is a compile-time `--dart-define` which
/// CI's bare `flutter test` never sets — through the public API this branch is unreachable in a
/// test, which is why the most intricate parsing in the class had no coverage at all.
library;

import 'dart:convert';

import 'package:equipcert_mobile/src/config/app_config.dart';
import 'package:equipcert_mobile/src/data/checklist_repository.dart';
import 'package:equipcert_mobile/src/data/models.dart';
import 'package:flutter_test/flutter_test.dart';

/// Build a Contentful Delivery API payload of the shape the space actually returns.
String _payload({
  required List<Object?> questions,
  String? typeName,
  bool inlineType = false,
  bool wrapQuestions = false,
}) {
  final Map<String, Object?> fields = <String, Object?>{
    'questions': wrapQuestions
        ? <String, Object?>{'questions': questions}
        : questions,
  };

  if (typeName != null) {
    fields['equipmentType'] = inlineType
        ? <String, Object?>{
            'fields': <String, Object?>{'name': typeName},
          }
        : <String, Object?>{
            'sys': <String, Object?>{'id': 'type-1'},
          };
  }

  final Map<String, Object?> body = <String, Object?>{
    'items': <Object?>[
      <String, Object?>{
        'sys': <String, Object?>{'id': 'entry-1'},
        'fields': fields,
      },
    ],
  };

  if (typeName != null && !inlineType) {
    body['includes'] = <String, Object?>{
      'Entry': <Object?>[
        <String, Object?>{
          'sys': <String, Object?>{'id': 'type-1'},
          'fields': <String, Object?>{'name': typeName},
        },
      ],
    };
  }

  return jsonEncode(body);
}

void main() {
  final ChecklistRepository repo = ChecklistRepository();

  group('the fallback is a real standard, not a placeholder', () {
    final ChecklistResult fallback = ChecklistRepository.fallbackChecklist;

    test('it is never empty', () {
      expect(fallback.entries, isNotEmpty);
    });

    test('it carries all eight NFPA 10 monthly points', () {
      expect(fallback.entries.length, 8);
      expect(ChecklistRepository.nfpa10MonthlyChecks.length, 8);
    });

    test('it is labelled as the fallback so the UI can say so', () {
      expect(fallback.source, ChecklistSource.fallback);
      expect(fallback.isFallback, isTrue);
    });

    test('every entry starts pending — nothing is pre-answered', () {
      for (final ChecklistEntry e in fallback.entries) {
        expect(e.status, ChecklistStatus.pending);
      }
    });

    test('ids are 1-based strings, matching what the web client writes', () {
      // The shape is part of the `checklist_data` contract. Changing it would make old and
      // new records disagree inside the same column.
      expect(
        fallback.entries.map((ChecklistEntry e) => e.id).toList(),
        <String>['1', '2', '3', '4', '5', '6', '7', '8'],
      );
    });

    test('no question is blank', () {
      for (final ChecklistEntry e in fallback.entries) {
        expect(e.question.trim(), isNotEmpty);
      }
    });

    test('it mentions the pressure gauge — a real NFPA 10 point', () {
      expect(
        fallback.entries.any(
          (ChecklistEntry e) => e.question.toLowerCase().contains('pressure'),
        ),
        isTrue,
      );
    });
  });

  group('forEquipment when Contentful is not configured', () {
    test('it returns the fallback rather than nothing', () async {
      // This is the state CI runs in, and the state of any build shipped without Contentful
      // defines. It must still produce a usable inspection.
      expect(ContentfulConfig.isConfigured, isFalse);
      final ChecklistResult r = await repo.forEquipment('CO2 Extinguisher');
      expect(r.entries, isNotEmpty);
      expect(r.isFallback, isTrue);
    });

    test('it does not throw on an empty equipment name', () async {
      final ChecklistResult r = await repo.forEquipment('');
      expect(r.entries, isNotEmpty);
    });
  });

  group('parseResponse — matching an entry to the equipment', () {
    test('an exact type name matches', () {
      final ChecklistResult r = repo.parseResponse(
        _payload(questions: <Object?>['Q1'], typeName: 'Extinguisher'),
        'Extinguisher',
      );
      expect(r.source, ChecklistSource.contentful);
      expect(r.entries.single.question, 'Q1');
    });

    test('the entry name may be contained in the equipment name', () {
      // "Extinguisher" should match equipment called "CO2 Extinguisher 5kg".
      final ChecklistResult r = repo.parseResponse(
        _payload(questions: <Object?>['Q1'], typeName: 'Extinguisher'),
        'CO2 Extinguisher 5kg',
      );
      expect(r.source, ChecklistSource.contentful);
    });

    test('the equipment name may be contained in the entry name', () {
      final ChecklistResult r = repo.parseResponse(
        _payload(questions: <Object?>['Q1'], typeName: 'CO2 Extinguisher 5kg'),
        'Extinguisher',
      );
      expect(r.source, ChecklistSource.contentful);
    });

    test('matching is case-insensitive', () {
      final ChecklistResult r = repo.parseResponse(
        _payload(questions: <Object?>['Q1'], typeName: 'EXTINGUISHER'),
        'extinguisher',
      );
      expect(r.source, ChecklistSource.contentful);
    });

    test('a non-matching type still yields questions, marked generic', () {
      // Better a real checklist labelled "generic" than no checklist. The UI states which.
      final ChecklistResult r = repo.parseResponse(
        _payload(questions: <Object?>['Q1'], typeName: 'Fire Blanket'),
        'Extinguisher',
      );
      expect(r.source, ChecklistSource.contentfulGeneric);
      expect(r.entries, isNotEmpty);
    });

    test('an entry with no equipmentType link is generic, not a crash', () {
      final ChecklistResult r = repo.parseResponse(
        _payload(questions: <Object?>['Q1']),
        'Extinguisher',
      );
      expect(r.source, ChecklistSource.contentfulGeneric);
    });

    test(
      'a type resolved inline rather than through includes still matches',
      () {
        final ChecklistResult r = repo.parseResponse(
          _payload(
            questions: <Object?>['Q1'],
            typeName: 'Extinguisher',
            inlineType: true,
          ),
          'Extinguisher',
        );
        expect(r.source, ChecklistSource.contentful);
      },
    );

    test(
      'a link pointing at an id absent from includes degrades to generic',
      () {
        final String body = jsonEncode(<String, Object?>{
          'items': <Object?>[
            <String, Object?>{
              'fields': <String, Object?>{
                'equipmentType': <String, Object?>{
                  'sys': <String, Object?>{'id': 'missing-id'},
                },
                'questions': <Object?>['Q1'],
              },
            },
          ],
          'includes': <String, Object?>{'Entry': <Object?>[]},
        });
        final ChecklistResult r = repo.parseResponse(body, 'Extinguisher');
        expect(r.source, ChecklistSource.contentfulGeneric);
        expect(r.entries, isNotEmpty);
      },
    );
  });

  group('parseResponse — the shapes a question can arrive in', () {
    test('a bare string', () {
      expect(
        repo
            .parseResponse(
              _payload(questions: <Object?>['Check the seal']),
              'x',
            )
            .entries
            .single
            .question,
        'Check the seal',
      );
    });

    test('an object keyed "text"', () {
      expect(
        repo
            .parseResponse(
              _payload(
                questions: <Object?>[
                  <String, Object?>{'text': 'Check the gauge'},
                ],
              ),
              'x',
            )
            .entries
            .single
            .question,
        'Check the gauge',
      );
    });

    test('an object keyed "question"', () {
      expect(
        repo
            .parseResponse(
              _payload(
                questions: <Object?>[
                  <String, Object?>{'question': 'Check the pin'},
                ],
              ),
              'x',
            )
            .entries
            .single
            .question,
        'Check the pin',
      );
    });

    test('questions wrapped in an object are unwrapped', () {
      // Both shapes exist in this space; the web client carries the same branch.
      final ChecklistResult r = repo.parseResponse(
        _payload(questions: <Object?>['Q1', 'Q2'], wrapQuestions: true),
        'x',
      );
      expect(r.entries.length, 2);
    });

    test('blank and whitespace-only questions are dropped', () {
      final ChecklistResult r = repo.parseResponse(
        _payload(questions: <Object?>['', '   ', 'Real question']),
        'x',
      );
      expect(r.entries.length, 1);
      expect(r.entries.single.question, 'Real question');
    });

    test('question text is trimmed', () {
      expect(
        repo
            .parseResponse(_payload(questions: <Object?>['  Padded  ']), 'x')
            .entries
            .single
            .question,
        'Padded',
      );
    });

    test('ids are renumbered 1-based after junk is dropped', () {
      // If a blank question left a gap, the ids would no longer match the rendered rows.
      final ChecklistResult r = repo.parseResponse(
        _payload(questions: <Object?>['A', '', 'B', '   ', 'C']),
        'x',
      );
      expect(r.entries.map((ChecklistEntry e) => e.id).toList(), <String>[
        '1',
        '2',
        '3',
      ]);
    });

    test('every parsed entry starts pending', () {
      final ChecklistResult r = repo.parseResponse(
        _payload(questions: <Object?>['A', 'B']),
        'x',
      );
      for (final ChecklistEntry e in r.entries) {
        expect(e.status, ChecklistStatus.pending);
      }
    });
  });

  group('parseResponse — every malformed input falls back, none throws', () {
    final Map<String, String> bad = <String, String>{
      'not JSON at all': 'this is not json',
      'a JSON array at the top level': '[]',
      'a JSON string at the top level': '"hello"',
      'an empty object': '{}',
      'items missing': '{"foo":1}',
      'items empty': '{"items":[]}',
      'items not a list': '{"items":"nope"}',
      'an item that is not an object': '{"items":[3]}',
      'an item with no fields': '{"items":[{}]}',
      'fields not an object': '{"items":[{"fields":7}]}',
      'questions missing': '{"items":[{"fields":{}}]}',
      'questions not a list': '{"items":[{"fields":{"questions":5}}]}',
      'questions all blank': '{"items":[{"fields":{"questions":["","  "]}}]}',
      'questions of unusable types':
          '{"items":[{"fields":{"questions":[1,true,null]}}]}',
      'includes not an object':
          '{"items":[{"fields":{"questions":[]}}],"includes":3}',
    };

    bad.forEach((String label, String body) {
      test('$label yields the fallback, not an empty list', () {
        late final ChecklistResult r;
        expect(
          () => r = repo.parseResponse(body, 'Extinguisher'),
          returnsNormally,
        );
        expect(r.entries, isNotEmpty);
        expect(r.isFallback, isTrue);
      });
    });
  });

  group('the invariant, stated once', () {
    test('no input in this suite ever produced an empty checklist', () {
      // A deliberately hostile sweep: whatever comes back, a technician has questions to
      // answer. An empty checklist would file a record asserting nothing was inspected.
      final List<String> inputs = <String>[
        '',
        'null',
        '{}',
        '[]',
        '{"items":[]}',
        'garbage',
        _payload(questions: <Object?>[]),
        _payload(questions: <Object?>['Q']),
      ];
      for (final String input in inputs) {
        final ChecklistResult r = repo.parseResponse(input, 'Extinguisher');
        expect(r.entries, isNotEmpty, reason: 'empty checklist for: $input');
      }
    });
  });
}
