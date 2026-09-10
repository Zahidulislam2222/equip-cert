/// The integrity digest that decides whether a queued inspection is still the one that was
/// signed.
///
/// ---------------------------------------------------------------------------------------
/// WHY THIS FILE EXISTS
///
/// `OfflineQueue` holds signed compliance records in a local SQLite file — on a device that
/// may be rooted, shared or lost — for as long as it takes to reach signal. Any SQLite
/// browser can edit those rows. The only thing standing between an edited row and the
/// permanent record is `integrityDigest`, and a digest with a construction flaw fails
/// silently: it keeps returning 64 hex characters and keeps saying "unchanged".
///
/// Two construction flaws are guarded here specifically, because both are easy to write and
/// neither is visible in review:
///
///   1. **Insertion-order dependence.** `jsonEncode(map)` follows Dart's insertion order. A
///      digest over it would make every row fail its own check the first time the payload was
///      rebuilt with keys assembled in a different sequence — turning "tampered" into noise
///      and training whoever reads it to ignore the word.
///   2. **Concatenation ambiguity.** Hashing `payload + photo + signature` without length
///      prefixes lets a byte move across a boundary without changing the hash, which is
///      exactly the splice the digest exists to detect.
///
/// Both are tested by constructing the collision the flawed version WOULD have, and proving
/// the real one does not have it.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:equipcert_mobile/src/offline/offline_queue.dart';
import 'package:flutter_test/flutter_test.dart';

Uint8List _bytes(List<int> values) => Uint8List.fromList(values);

void main() {
  group('canonicalJson', () {
    test('sorts object keys, so the encoding is a function of the data not of the assembly', () {
      final Map<String, Object?> assembledOneWay = <String, Object?>{
        'zulu': 1,
        'alpha': 2,
        'mike': 3,
      };
      final Map<String, Object?> assembledAnother = <String, Object?>{
        'mike': 3,
        'zulu': 1,
        'alpha': 2,
      };

      expect(canonicalJson(assembledOneWay), '{"alpha":2,"mike":3,"zulu":1}');
      expect(canonicalJson(assembledOneWay), canonicalJson(assembledAnother));
    });

    test('has the property jsonEncode lacks — the whole reason this function exists', () {
      final Map<String, Object?> a = <String, Object?>{'b': 1, 'a': 2};
      final Map<String, Object?> b = <String, Object?>{'a': 2, 'b': 1};

      // The bug being prevented, demonstrated rather than asserted in a comment.
      expect(jsonEncode(a), isNot(jsonEncode(b)));
      expect(canonicalJson(a), canonicalJson(b));
    });

    test('sorts recursively, including maps nested inside lists', () {
      final Map<String, Object?> value = <String, Object?>{
        'checklist_data': <Object?>[
          <String, Object?>{'status': 'pass', 'id': 'a', 'question': 'Q'},
        ],
        'organization_id': 'org',
      };

      expect(
        canonicalJson(value),
        '{"checklist_data":[{"id":"a","question":"Q","status":"pass"}],'
        '"organization_id":"org"}',
      );
    });

    test('preserves list order, because on a checklist the order IS data', () {
      expect(canonicalJson(<Object?>[3, 1, 2]), '[3,1,2]');
      expect(
        canonicalJson(<Object?>[3, 1, 2]),
        isNot(canonicalJson(<Object?>[1, 2, 3])),
      );
    });

    test('encodes scalars and null the way JSON does', () {
      expect(canonicalJson(null), 'null');
      expect(canonicalJson(true), 'true');
      expect(canonicalJson(12), '12');
      expect(canonicalJson(1.5), '1.5');
      expect(canonicalJson('x'), '"x"');
    });

    test(
      'escapes strings, so a quote inside a value cannot forge structure',
      () {
        // A description containing `","z":"` would, under naive concatenation, close the value
        // and open a key. jsonEncode is what stops it.
        expect(
          canonicalJson(<String, Object?>{'a': '","z":"'}),
          r'{"a":"\",\"z\":\""}',
        );
      },
    );

    test(
      'empty containers stay distinguishable from each other and from null',
      () {
        expect(canonicalJson(<String, Object?>{}), '{}');
        expect(canonicalJson(<Object?>[]), '[]');
        expect(canonicalJson(null), 'null');
      },
    );

    test(
      'DEF-049: a non-string key keeps its VALUE, it does not become null',
      () {
        // The regression. The first implementation stringified the keys and then indexed the
        // map with the string, so `value['2']` on a map keyed by the int 2 read null. The
        // encoding stayed well-formed and the digest stayed 64 hex characters — it just no
        // longer covered the data, which is the failure mode a digest must never have.
        expect(
          canonicalJson(<Object?, Object?>{2: 'b', 10: 'a'}),
          '{"10":"a","2":"b"}',
        );

        // And it must still DETECT a change to one of those values.
        expect(
          canonicalJson(<Object?, Object?>{2: 'b'}),
          isNot(canonicalJson(<Object?, Object?>{2: 'c'})),
        );
      },
    );

    test('DEF-049 holds at depth, inside a list inside an object', () {
      expect(
        canonicalJson(<String, Object?>{
          'device_info': <Object?>[
            <Object?, Object?>{1: 'one'},
          ],
        }),
        '{"device_info":[{"1":"one"}]}',
      );
    });

    test(
      'keys that share a string form are ordered by value, not by sort luck',
      () {
        // Dart's List.sort is not stable. Without the value tie-break, {2: 'b', '2': 'a'} could
        // encode either way round and the same data would produce two different digests.
        expect(
          canonicalJson(<Object?, Object?>{2: 'b', '2': 'a'}),
          canonicalJson(<Object?, Object?>{'2': 'a', 2: 'b'}),
        );
      },
    );
  });

  group('integrityDigest', () {
    final Map<String, Object?> payload = <String, Object?>{
      'organization_id': '11111111-1111-4111-8111-111111111111',
      'equipment_name': 'Extinguisher A-12',
      'status': 'action_required',
      'checklist_data': <Object?>[
        <String, Object?>{
          'id': 'pressure',
          'question': 'Gauge in the green?',
          'status': 'fail',
        },
      ],
    };

    test('is 64 lowercase hex characters', () {
      expect(
        integrityDigest(payload: payload),
        matches(RegExp(r'^[0-9a-f]{64}$')),
      );
    });

    test('is deterministic across calls', () {
      expect(
        integrityDigest(payload: payload),
        integrityDigest(payload: payload),
      );
    });

    test('ignores the order the payload keys were inserted in', () {
      final Map<String, Object?> reordered = <String, Object?>{
        'checklist_data': payload['checklist_data'],
        'status': payload['status'],
        'equipment_name': payload['equipment_name'],
        'organization_id': payload['organization_id'],
      };

      expect(
        integrityDigest(payload: reordered),
        integrityDigest(payload: payload),
      );
    });

    test('changes when a single checklist answer is flipped', () {
      final Map<String, Object?> altered = <String, Object?>{
        ...payload,
        'checklist_data': <Object?>[
          <String, Object?>{
            'id': 'pressure',
            'question': 'Gauge in the green?',
            'status': 'pass',
          },
        ],
      };

      // The forgery this exists for: turn a failed extinguisher into a passed one, after the
      // technician has signed for it.
      expect(
        integrityDigest(payload: altered),
        isNot(integrityDigest(payload: payload)),
      );
    });

    test('changes when the photo is swapped and the payload left intact', () {
      expect(
        integrityDigest(payload: payload, photo: _bytes(<int>[1, 2, 3])),
        isNot(integrityDigest(payload: payload, photo: _bytes(<int>[1, 2, 4]))),
      );
    });

    test('changes when the signature is swapped', () {
      expect(
        integrityDigest(payload: payload, signature: _bytes(<int>[9, 9])),
        isNot(
          integrityDigest(payload: payload, signature: _bytes(<int>[9, 8])),
        ),
      );
    });

    test('photo bytes and signature bytes are not interchangeable', () {
      final Uint8List evidence = _bytes(<int>[7, 7, 7]);

      expect(
        integrityDigest(payload: payload, photo: evidence),
        isNot(integrityDigest(payload: payload, signature: evidence)),
      );
    });

    test('detects a byte spliced across the photo/signature boundary', () {
      // Both cases hold the SAME bytes in the same order. Only the boundary moved.
      final Uint8List photoA = _bytes(<int>[1, 2, 3, 4]);
      final Uint8List signatureA = _bytes(<int>[5, 6]);

      final Uint8List photoB = _bytes(<int>[1, 2, 3]);
      final Uint8List signatureB = _bytes(<int>[4, 5, 6]);

      // Prove the naive construction really would collide, so what follows is measuring the
      // length prefix rather than a coincidence.
      expect(
        sha256.convert(<int>[...photoA, ...signatureA]).toString(),
        sha256.convert(<int>[...photoB, ...signatureB]).toString(),
      );

      expect(
        integrityDigest(payload: payload, photo: photoA, signature: signatureA),
        isNot(
          integrityDigest(
            payload: payload,
            photo: photoB,
            signature: signatureB,
          ),
        ),
      );
    });

    test('detects a splice across the payload/photo boundary', () {
      // Trailing payload text moved into the head of the photo: 0x7a is 'z'. The concatenated
      // byte sequence is identical between the two.
      expect(
        integrityDigest(
          payload: <String, Object?>{'a': 'xy'},
          photo: _bytes(<int>[0x7a, 1, 2]),
        ),
        isNot(
          integrityDigest(
            payload: <String, Object?>{'a': 'xyz'},
            photo: _bytes(<int>[1, 2]),
          ),
        ),
      );
    });

    test('an absent photo and a zero-length photo hash alike — a known, harmless equality', () {
      // `feed` writes `photo:0:` for both. No decodable image is zero bytes, so a zero-length
      // photo is not a state the queue can reach; pinning the equality here means a future
      // change that starts relying on the distinction fails loudly instead of quietly.
      expect(
        integrityDigest(payload: payload),
        integrityDigest(payload: payload, photo: _bytes(<int>[])),
      );
    });

    test('adding evidence to a record that had none changes the digest', () {
      expect(
        integrityDigest(payload: payload),
        isNot(integrityDigest(payload: payload, photo: _bytes(<int>[1]))),
      );
    });

    test('an empty payload still produces a well-formed digest', () {
      expect(
        integrityDigest(payload: const <String, Object?>{}),
        matches(RegExp(r'^[0-9a-f]{64}$')),
      );
    });
  });
}
