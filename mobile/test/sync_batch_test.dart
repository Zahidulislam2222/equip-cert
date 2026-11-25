/// selectSyncBatch — whose queued signed records one sync pass may file (review 2026-11-25).
library;

import 'dart:convert';

import 'package:equipcert_mobile/src/offline/offline_queue.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, Object?> row(
  String id, {
  required bool signed,
  String? inspector,
}) => <String, Object?>{
  'id': id,
  'payload': jsonEncode(<String, Object?>{'inspector_id': inspector}),
  'signed': signed ? 1 : 0,
};

void main() {
  test('a colleague\'s signed record is held; everything else is sent', () {
    final (List<String> batch, int held) = selectSyncBatch(
      index: <Map<String, Object?>>[
        row('a', signed: true, inspector: 'colleague'),
        row('b', signed: true, inspector: 'me'),
        row('c', signed: false, inspector: 'colleague'),
      ],
      currentProfileId: 'me',
      batchSize: 10,
    );
    expect(batch, <String>['b', 'c']);
    expect(held, 1);
  });

  test('signed out: every signed record is held, unsigned ones still go', () {
    final (List<String> batch, int held) = selectSyncBatch(
      index: <Map<String, Object?>>[
        row('a', signed: true, inspector: 'me'),
        row('b', signed: false, inspector: 'me'),
      ],
      currentProfileId: null,
      batchSize: 10,
    );
    expect(batch, <String>['b']);
    expect(held, 1);
  });

  test('held rows never starve the batch, even when they are the oldest', () {
    final (List<String> batch, int held) = selectSyncBatch(
      index: <Map<String, Object?>>[
        for (int i = 0; i < 5; i++)
          row('old$i', signed: true, inspector: 'colleague'),
        row('mine1', signed: true, inspector: 'me'),
        row('mine2', signed: false, inspector: 'me'),
        row('mine3', signed: false, inspector: 'me'),
      ],
      currentProfileId: 'me',
      batchSize: 2,
    );
    expect(batch, <String>['mine1', 'mine2']);
    expect(held, 5);
  });
}
