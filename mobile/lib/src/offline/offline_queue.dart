/// Inspections captured with no connection, held until there is one.
///
/// ---------------------------------------------------------------------------------------
/// WHY THIS IS THE FEATURE, NOT A NICETY
///
/// The place a fire extinguisher lives is a plant room, a stairwell core, a basement, a riser
/// cupboard. Those are the places with no signal, by construction. An inspection app that
/// requires connectivity at the moment of inspection is an office app, and the technician
/// works around it on paper — which is the workflow this product exists to replace.
///
/// ---------------------------------------------------------------------------------------
/// WHY QUEUED ROWS CARRY AN INTEGRITY DIGEST
///
/// A queued inspection is a **signed compliance record** sitting in a local SQLite file, on a
/// device that may be rooted, shared, or lost, for as long as it takes to reach signal. Rows
/// in that file are trivially editable with any SQLite browser.
///
/// So each row stores a SHA-256 over its canonical payload plus the bytes of its evidence, and
/// the digest is recomputed before the record is sent. A row that no longer matches its digest
/// is NOT uploaded and NOT silently dropped: it is quarantined with a reason, and the
/// technician is told, because "your signed inspection was altered" is not something to
/// resolve on the device's behalf.
///
/// This is integrity, not authentication. It detects modification; it does not prove
/// authorship, because a local HMAC key would sit on the same device as the data it protects.
/// Proving authorship needs server-side signing, which is recorded as a known limit rather
/// than implied.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:meta/meta.dart';
import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../config/app_config.dart';
import '../data/evidence_repository.dart';
import '../data/inspection_repository.dart';
import '../util/uuid.dart';

/// What happened to one queued row on a sync pass.
enum SyncOutcome {
  /// Filed successfully; the row is gone from the queue.
  submitted,

  /// The upload or insert failed and the row will be retried.
  retryable,

  /// The row failed [OfflineConfig.maxSyncAttempts] times and is now surfaced to the person
  /// instead of being retried for ever.
  exhausted,

  /// The digest did not match. Quarantined, never sent.
  tampered,
}

@immutable
class SyncReport {
  const SyncReport({
    required this.submitted,
    required this.retryable,
    required this.exhausted,
    required this.tampered,
  });

  static const SyncReport empty = SyncReport(
    submitted: 0,
    retryable: 0,
    exhausted: 0,
    tampered: 0,
  );

  final int submitted;
  final int retryable;
  final int exhausted;
  final int tampered;

  bool get didAnything => submitted + retryable + exhausted + tampered > 0;
  bool get needsAttention => exhausted > 0 || tampered > 0;
}

/// One pending submission.
@immutable
class QueuedInspection {
  const QueuedInspection({
    required this.id,
    required this.payload,
    required this.capturedAt,
    required this.attempts,
    required this.equipmentName,
    this.photo,
    this.photoFormat,
    this.signature,
    this.lastError,
    this.quarantined = false,
  });

  final String id;

  /// Exactly the map [buildInspectionInsert] produces — the same one the online path sends.
  final Map<String, Object?> payload;

  final DateTime capturedAt;
  final int attempts;
  final String equipmentName;

  /// Evidence bytes, held locally because the upload has to happen at sync time. The object
  /// path cannot be allocated earlier: the upload is what creates it.
  final Uint8List? photo;
  final EvidenceFormat? photoFormat;
  final Uint8List? signature;

  final String? lastError;
  final bool quarantined;
}

/// Canonical JSON: object keys sorted, recursively.
///
/// A digest over `jsonEncode(map)` alone is worthless, because Dart's map iteration order is
/// insertion order — re-serialising the same logical payload with keys added in a different
/// sequence yields a different string and therefore a different hash. Every row would fail its
/// own integrity check the first time the payload was rebuilt. Sorting makes the encoding a
/// function of the DATA rather than of how the data happened to be assembled.
String canonicalJson(Object? value) {
  final StringBuffer out = StringBuffer();
  _writeCanonical(value, out);
  return out.toString();
}

void _writeCanonical(Object? value, StringBuffer out) {
  if (value is Map) {
    // Sort by the STRINGIFIED key while carrying the value along. Stringifying the keys and
    // then indexing the map with the string reads null for every key that was not already a
    // String — so the digest would be taken over nulls, and any later edit to those values
    // would go undetected. That is total integrity loss, and silent, on the one function
    // whose whole job is to be neither. DEF-049.
    //
    // Ties are broken by the encoded value so that two keys with the same string form (2 and
    // '2') cannot make the output depend on Dart's non-stable sort.
    final List<MapEntry<String, Object?>> entries =
        value.entries
            .map(
              (MapEntry<Object?, Object?> entry) =>
                  MapEntry<String, Object?>(entry.key.toString(), entry.value),
            )
            .toList()
          ..sort((MapEntry<String, Object?> a, MapEntry<String, Object?> b) {
            final int byKey = a.key.compareTo(b.key);
            return byKey != 0
                ? byKey
                : canonicalJson(a.value).compareTo(canonicalJson(b.value));
          });

    out.write('{');
    for (int i = 0; i < entries.length; i++) {
      if (i > 0) out.write(',');
      out.write(jsonEncode(entries[i].key));
      out.write(':');
      _writeCanonical(entries[i].value, out);
    }
    out.write('}');
    return;
  }

  if (value is List) {
    out.write('[');
    for (int i = 0; i < value.length; i++) {
      if (i > 0) out.write(',');
      _writeCanonical(value[i], out);
    }
    out.write(']');
    return;
  }

  // Scalars: jsonEncode already emits a canonical form for strings, numbers, booleans, null.
  out.write(jsonEncode(value));
}

/// SHA-256 over the payload and the evidence bytes together.
///
/// The evidence is included because a payload-only digest would let someone swap the photo
/// while leaving the record that describes it intact — which, on an inspection, is the more
/// useful forgery of the two.
///
/// Each part is LENGTH-PREFIXED and labelled. Without that, concatenation is ambiguous: moving
/// one byte from the end of the photo to the start of the signature would produce an identical
/// hash, so the digest would not detect exactly the kind of splice it exists to detect.
String integrityDigest({
  required Map<String, Object?> payload,
  Uint8List? photo,
  Uint8List? signature,
}) {
  final BytesBuilder input = BytesBuilder(copy: false);

  void feed(String label, List<int>? bytes) {
    input.add(utf8.encode('$label:${bytes?.length ?? 0}:'));
    if (bytes != null) input.add(bytes);
  }

  feed('payload', utf8.encode(canonicalJson(payload)));
  feed('photo', photo);
  feed('signature', signature);

  return sha256.convert(input.takeBytes()).toString();
}

class OfflineQueue {
  /// Private field formals. The call site still writes `inspections:` and `evidence:` — Dart
  /// derives the public parameter name from the private field — so this is the same API with
  /// one fewer place for the two names to disagree.
  OfflineQueue({
    required this._inspections,
    required this._evidence,
    this._database,
  });

  final InspectionRepository _inspections;
  final EvidenceRepository _evidence;

  Database? _database;

  static const String _table = 'queued_inspections';

  Future<Database> _open() async {
    final Database? existing = _database;
    if (existing != null) return existing;

    final String directory = await getDatabasesPath();
    final Database database = await openDatabase(
      p.join(directory, 'equipcert_offline.db'),
      version: 1,
      onCreate: (Database db, int _) async {
        await db.execute('''
          CREATE TABLE $_table (
            id             TEXT PRIMARY KEY,
            payload        TEXT NOT NULL,
            photo          BLOB,
            photo_mime     TEXT,
            signature      BLOB,
            digest         TEXT NOT NULL,
            equipment_name TEXT NOT NULL,
            captured_at    INTEGER NOT NULL,
            attempts       INTEGER NOT NULL DEFAULT 0,
            last_error     TEXT,
            quarantined    INTEGER NOT NULL DEFAULT 0
          )
        ''');
        // Sync drains oldest-first: an inspection captured at 09:00 should reach the record
        // before one captured at 11:00, so a partial drain on a brief connection still
        // produces a sensible chronology.
        await db.execute(
          'CREATE INDEX idx_queue_order ON $_table(quarantined, captured_at)',
        );
      },
    );

    _database = database;
    return database;
  }

  /// Hold an inspection locally. Returns the queue id.
  Future<String> enqueue({
    required Map<String, Object?> payload,
    required String equipmentName,
    Uint8List? photo,
    EvidenceFormat? photoFormat,
    Uint8List? signature,
  }) async {
    final Database db = await _open();
    final String id = uuidV4();

    await db.insert(_table, <String, Object?>{
      'id': id,
      'payload': jsonEncode(payload),
      'photo': photo,
      'photo_mime': photoFormat?.mimeType,
      'signature': signature,
      'digest': integrityDigest(
        payload: payload,
        photo: photo,
        signature: signature,
      ),
      'equipment_name': equipmentName,
      'captured_at': DateTime.now().millisecondsSinceEpoch,
      'attempts': 0,
      'quarantined': 0,
    });

    return id;
  }

  Future<int> pendingCount() async {
    final Database db = await _open();
    final List<Map<String, Object?>> rows = await db.rawQuery(
      'SELECT COUNT(*) AS n FROM $_table WHERE quarantined = 0',
    );
    return (rows.first['n'] as int?) ?? 0;
  }

  Future<List<QueuedInspection>> all() async {
    final Database db = await _open();
    final List<Map<String, Object?>> rows = await db.query(
      _table,
      orderBy: 'captured_at ASC',
    );
    return rows.map(_fromRow).toList(growable: false);
  }

  /// Attempt to file up to [OfflineConfig.syncBatchSize] queued inspections.
  ///
  /// Bounded on purpose. An unbounded drain on a weak connection holds the app busy for as
  /// long as the backlog takes, and the technician cannot start the next inspection while it
  /// runs. A bounded pass returns, and the next trigger continues.
  Future<SyncReport> sync() async {
    final Database db = await _open();

    final List<Map<String, Object?>> rows = await db.query(
      _table,
      where: 'quarantined = 0',
      orderBy: 'captured_at ASC',
      limit: OfflineConfig.syncBatchSize,
    );

    int submitted = 0;
    int retryable = 0;
    int exhausted = 0;
    int tampered = 0;

    for (final Map<String, Object?> row in rows) {
      switch (await _syncOne(db, row)) {
        case SyncOutcome.submitted:
          submitted++;
        case SyncOutcome.retryable:
          retryable++;
        case SyncOutcome.exhausted:
          exhausted++;
        case SyncOutcome.tampered:
          tampered++;
      }
    }

    return SyncReport(
      submitted: submitted,
      retryable: retryable,
      exhausted: exhausted,
      tampered: tampered,
    );
  }

  Future<SyncOutcome> _syncOne(Database db, Map<String, Object?> row) async {
    final String id = row['id']! as String;
    final QueuedInspection queued = _fromRow(row);

    // Integrity first, before any network call. A modified record must never reach the
    // database, and checking after the upload would already have published the evidence.
    final String recomputed = integrityDigest(
      payload: queued.payload,
      photo: queued.photo,
      signature: queued.signature,
    );

    if (recomputed != row['digest']) {
      await db.update(
        _table,
        <String, Object?>{
          'quarantined': 1,
          'last_error': 'Integrity check failed: this record was altered after it was signed.',
        },
        where: 'id = ?',
        whereArgs: <Object?>[id],
      );
      return SyncOutcome.tampered;
    }

    try {
      final String organizationId =
          queued.payload['organization_id']! as String;
      final Map<String, Object?> payload = Map<String, Object?>.from(
        queued.payload,
      );

      // Evidence is uploaded at sync time, not capture time — there was no connection at
      // capture time, which is the entire reason the row is here.
      if (queued.photo != null && queued.photoFormat != null) {
        payload['photo_url'] = await _evidence.upload(
          kind: EvidenceKind.inspection,
          organizationId: organizationId,
          bytes: queued.photo!,
          format: queued.photoFormat!,
        );
      }

      if (queued.signature != null) {
        payload['signature_url'] = await _evidence.upload(
          kind: EvidenceKind.signature,
          organizationId: organizationId,
          bytes: queued.signature!,
          format: EvidenceFormat.png,
        );
      }

      await _inspections.submit(payload);

      // Only now. Deleting before the insert confirms would lose the inspection outright,
      // and this record cannot be recreated — the technician has left the plant room.
      await db.delete(_table, where: 'id = ?', whereArgs: <Object?>[id]);
      return SyncOutcome.submitted;
    } catch (error) {
      final int attempts = (row['attempts']! as int) + 1;
      final bool giveUp = attempts >= OfflineConfig.maxSyncAttempts;

      await db.update(
        _table,
        <String, Object?>{
          'attempts': attempts,
          'quarantined': giveUp ? 1 : 0,
          // The message is stored for the person, so it is summarised rather than dumped: a
          // PostgREST error names tables and policies.
          'last_error': _describe(error),
        },
        where: 'id = ?',
        whereArgs: <Object?>[id],
      );

      return giveUp ? SyncOutcome.exhausted : SyncOutcome.retryable;
    }
  }

  /// Put a quarantined row back in the queue.
  ///
  /// Only offered for rows that ran out of attempts. A row quarantined for a FAILED INTEGRITY
  /// CHECK is never retryable: re-signing altered evidence is precisely what must not be
  /// possible, and the check would fail again anyway.
  Future<bool> retry(String id) async {
    final Database db = await _open();
    final List<Map<String, Object?>> rows = await db.query(
      _table,
      where: 'id = ?',
      whereArgs: <Object?>[id],
      limit: 1,
    );
    if (rows.isEmpty) return false;

    final QueuedInspection queued = _fromRow(rows.first);
    final String recomputed = integrityDigest(
      payload: queued.payload,
      photo: queued.photo,
      signature: queued.signature,
    );
    if (recomputed != rows.first['digest']) return false;

    await db.update(
      _table,
      <String, Object?>{'quarantined': 0, 'attempts': 0, 'last_error': null},
      where: 'id = ?',
      whereArgs: <Object?>[id],
    );
    return true;
  }

  /// Remove a row.
  ///
  /// Discarding a quarantined inspection destroys a signed record, so nothing calls this
  /// automatically — it exists so a technician can deliberately abandon a submission after
  /// being told what it was.
  Future<void> discard(String id) async {
    final Database db = await _open();
    await db.delete(_table, where: 'id = ?', whereArgs: <Object?>[id]);
  }

  Future<void> close() async {
    await _database?.close();
    _database = null;
  }

  QueuedInspection _fromRow(Map<String, Object?> row) {
    final Object? decoded = jsonDecode(row['payload']! as String);

    return QueuedInspection(
      id: row['id']! as String,
      payload: decoded is Map<String, dynamic>
          ? Map<String, Object?>.from(decoded)
          : <String, Object?>{},
      capturedAt: DateTime.fromMillisecondsSinceEpoch(
        row['captured_at']! as int,
      ),
      attempts: row['attempts']! as int,
      equipmentName: row['equipment_name']! as String,
      photo: row['photo'] as Uint8List?,
      photoFormat: EvidenceFormat.fromMimeType(
        (row['photo_mime'] as String?) ?? '',
      ),
      signature: row['signature'] as Uint8List?,
      lastError: row['last_error'] as String?,
      quarantined: (row['quarantined'] as int? ?? 0) == 1,
    );
  }

  static String _describe(Object error) {
    // Deliberately coarse. A PostgrestException carries the table, the column and often the
    // policy name; that belongs in a log, not on a technician's screen, and it is a small
    // disclosure of the schema to anyone holding the phone.
    if (error is StorageException) {
      return 'Could not upload the photo or signature.';
    }
    if (error is PostgrestException) {
      return 'The server rejected the inspection.';
    }
    return 'Could not file the inspection. It is still queued.';
  }
}

final Provider<OfflineQueue> offlineQueueProvider = Provider<OfflineQueue>((
  Ref ref,
) {
  final OfflineQueue queue = OfflineQueue(
    inspections: ref.watch(inspectionRepositoryProvider),
    evidence: ref.watch(evidenceRepositoryProvider),
  );
  ref.onDispose(queue.close);
  return queue;
});
