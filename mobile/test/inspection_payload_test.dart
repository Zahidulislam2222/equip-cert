/// The two pure functions that build what actually reaches the database.
///
/// ---------------------------------------------------------------------------------------
/// WHAT THIS IS FOR, AND WHAT IT IS NOT
///
/// `schema_contract_test.dart` already proves that the column NAMES these functions emit
/// exist in the migrations. It cannot prove the VALUES satisfy the CHECK constraints, because
/// it never runs a payload through anything. This file does that half:
///
///   * `location_is_a_pair`          — both coordinates or neither, never one
///   * `ai_provenance_is_complete`   — all four AI columns together or all four empty
///   * `length(btrim(x)) BETWEEN 1 AND 200`   on equipment_name and inspector_name
///   * `length(btrim(description)) BETWEEN 1 AND 5000` on a corrective action
///
/// Every one of those is enforced by Postgres at INSERT time — which is after the photo has
/// been uploaded and the signature captured, standing in a plant room with no signal. A
/// constraint violation discovered there costs the technician the whole inspection. Catching
/// it here costs nothing.
library;

import 'package:equipcert_mobile/src/compliance/ai_provenance.dart';
import 'package:equipcert_mobile/src/data/inspection_repository.dart';
import 'package:equipcert_mobile/src/data/models.dart';
import 'package:flutter_test/flutter_test.dart';

const String _org = '11111111-1111-4111-8111-111111111111';

List<ChecklistEntry> _checklist(
  List<ChecklistStatus> statuses,
) => <ChecklistEntry>[
  for (int i = 0; i < statuses.length; i++)
    ChecklistEntry(id: 'item-$i', question: 'Question $i', status: statuses[i]),
];

Map<String, Object?> _insert({
  String equipmentName = 'Extinguisher A-12',
  String inspectorName = 'A. Technician',
  List<ChecklistEntry>? checklist,
  AiProvenance? provenance,
  GeoPoint? location,
  String? locationAddress,
  String? photoPath,
  String? signaturePath,
}) => buildInspectionInsert(
  organizationId: _org,
  equipmentName: equipmentName,
  inspectorName: inspectorName,
  checklist: checklist ?? _checklist(<ChecklistStatus>[ChecklistStatus.pass]),
  provenance: provenance,
  location: location,
  locationAddress: locationAddress,
  photoPath: photoPath,
  signaturePath: signaturePath,
);

void main() {
  group('GeoPoint.tryCreate makes location_is_a_pair unrepresentable', () {
    test('a full pair is accepted', () {
      final GeoPoint? point = GeoPoint.tryCreate(51.5072, -0.1276);

      expect(point, isNotNull);
      expect(point!.latitude, 51.5072);
      expect(point.longitude, -0.1276);
    });

    test('half a fix is no fix — either coordinate missing returns null', () {
      // The exact shape the constraint rejects: a GPS read that returns latitude and times
      // out before longitude. Two nullable doubles threaded through a widget tree eventually
      // reach this state; one nullable object cannot.
      expect(GeoPoint.tryCreate(51.5072, null), isNull);
      expect(GeoPoint.tryCreate(null, -0.1276), isNull);
      expect(GeoPoint.tryCreate(null, null), isNull);
    });

    test('NaN is rejected — it would pass every naive range comparison', () {
      // NaN < -90 is false and NaN > 90 is false, so a range check alone lets it through and
      // the NUMERIC column rejects it at insert time.
      expect(GeoPoint.tryCreate(double.nan, 0), isNull);
      expect(GeoPoint.tryCreate(0, double.nan), isNull);
    });

    test('infinity is rejected by the range check', () {
      expect(GeoPoint.tryCreate(double.infinity, 0), isNull);
      expect(GeoPoint.tryCreate(0, double.negativeInfinity), isNull);
    });

    test('out-of-range coordinates are rejected on both axes', () {
      expect(GeoPoint.tryCreate(90.1, 0), isNull);
      expect(GeoPoint.tryCreate(-90.1, 0), isNull);
      expect(GeoPoint.tryCreate(0, 180.1), isNull);
      expect(GeoPoint.tryCreate(0, -180.1), isNull);
    });

    test(
      'the poles and the antimeridian are valid, not off-by-one rejections',
      () {
        expect(GeoPoint.tryCreate(90, 180), isNotNull);
        expect(GeoPoint.tryCreate(-90, -180), isNotNull);
        expect(GeoPoint.tryCreate(0, 0), isNotNull);
      },
    );

    test('lat/lng round to the six decimals the NUMERIC(9,6) column holds', () {
      // Sending more precision than the column stores means the value read back differs from
      // the value sent, which makes an offline-sync integrity comparison fail for no reason.
      final GeoPoint point = GeoPoint.tryCreate(51.50729999, -0.12761111)!;

      expect(point.lat, 51.5073);
      expect(point.lng, -0.127611);
    });

    test('rounding does not push a boundary value out of range', () {
      final GeoPoint point = GeoPoint.tryCreate(89.9999999, 179.9999999)!;

      expect(point.lat, lessThanOrEqualTo(90));
      expect(point.lng, lessThanOrEqualTo(180));
    });
  });

  group('statusFor', () {
    test('all passed is safe', () {
      expect(
        statusFor(
          _checklist(<ChecklistStatus>[
            ChecklistStatus.pass,
            ChecklistStatus.pass,
          ]),
        ),
        InspectionStatus.safe,
      );
    });

    test('one failure makes the whole inspection action_required', () {
      expect(
        statusFor(
          _checklist(<ChecklistStatus>[
            ChecklistStatus.pass,
            ChecklistStatus.fail,
          ]),
        ),
        InspectionStatus.actionRequired,
      );
    });

    test('a PENDING item is not a pass', () {
      // The submit guard should never let one through. Treating pending as passing would file
      // an incomplete inspection as safe, so it counts as unresolved instead — the safe
      // direction if the guard is ever weakened.
      expect(
        statusFor(_checklist(<ChecklistStatus>[ChecklistStatus.pending])),
        InspectionStatus.actionRequired,
      );
    });

    test('an empty checklist is safe — nothing failed, and the guard blocks it upstream', () {
      expect(statusFor(const <ChecklistEntry>[]), InspectionStatus.safe);
    });
  });

  group('buildInspectionInsert', () {
    test('refuses to build without an organisation', () {
      // RLS scopes every row by organization_id. A blank one is not a row that fails to
      // insert, it is a row that could land in the wrong tenant if a policy ever loosened.
      expect(
        () => buildInspectionInsert(
          organizationId: '',
          equipmentName: 'x',
          inspectorName: 'y',
          checklist: const <ChecklistEntry>[],
        ),
        throwsArgumentError,
      );
    });

    test('created_at is deliberately absent', () {
      // Server-generated. A client-supplied inspection time is not evidence, because the
      // device clock is under the control of the person being audited.
      expect(_insert().containsKey('created_at'), isFalse);
    });

    test('the inspector is the human, never the model', () {
      final Map<String, Object?> payload = _insert(
        provenance: AiProvenance.tryParse(const <String, Object?>{
          'aiAssisted': true,
          'provider': 'test-provider-one',
          'model': 'test-model-alpha',
          'disclosedAt': '2026-09-11T09:15:00.000Z',
        }),
      );

      // NFPA 10 and OSHA 1910.157(e) both require a qualified person as the inspector of
      // record. AI involvement lives in the ai_* columns and nowhere else.
      expect(payload['inspector_name'], 'A. Technician');
      expect(payload['ai_model'], 'test-model-alpha');
    });

    test('a blank name becomes a stated fallback, never an empty string', () {
      // The column is NOT NULL with `length(btrim(x)) BETWEEN 1 AND 200`. Whitespace fails it.
      final Map<String, Object?> payload = _insert(
        equipmentName: '   ',
        inspectorName: '\t',
      );

      expect(payload['equipment_name'], 'Unidentified equipment');
      expect(payload['inspector_name'], 'Unknown inspector');
    });

    test('an over-long name is truncated to the 200 the column accepts', () {
      final Map<String, Object?> payload = _insert(equipmentName: 'A' * 500);

      expect((payload['equipment_name']! as String).length, 200);
    });

    test(
      'a name is trimmed, so trailing whitespace cannot eat the 200 budget',
      () {
        expect(
          _insert(equipmentName: '  Riser 3  ')['equipment_name'],
          'Riser 3',
        );
      },
    );

    test('location is written as a pair or not at all', () {
      final Map<String, Object?> without = _insert();
      expect(without['location_lat'], isNull);
      expect(without['location_lng'], isNull);

      final Map<String, Object?> with_ = _insert(
        location: GeoPoint.tryCreate(51.5072, -0.1276),
      );
      expect(with_['location_lat'], isNotNull);
      expect(with_['location_lng'], isNotNull);
    });

    test('an address with no coordinates is still a valid row', () {
      // `location_is_a_pair` constrains the two coordinates to each other. It says nothing
      // about the address, and a reverse-geocode failure must not lose the fix or the row.
      final Map<String, Object?> payload = _insert(
        locationAddress: 'Basement plant room',
      );

      expect(payload['location_address'], 'Basement plant room');
      expect(payload['location_lat'], isNull);
      expect(payload['location_lng'], isNull);
    });

    test('evidence is stored as PATHS, not signed URLs — DEF-017', () {
      final Map<String, Object?> payload = _insert(
        photoPath: 'org/2026/09/photo.jpg',
        signaturePath: 'org/2026/09/sig.png',
      );

      // A signed URL expires. Storing one means the evidence on a compliance record becomes
      // unreachable the moment the signature does, months before the retention period ends.
      expect(payload['photo_url'], 'org/2026/09/photo.jpg');
      expect(payload['signature_url'], 'org/2026/09/sig.png');
      expect(payload['photo_url'], isNot(contains('http')));
    });

    test('all four AI columns are present with no provenance, and ai_assisted is false', () {
      final Map<String, Object?> payload = _insert();

      expect(payload['ai_assisted'], false);
      expect(payload.containsKey('ai_provider'), isTrue);
      expect(payload.containsKey('ai_model'), isTrue);
      expect(payload.containsKey('ai_disclosed_at'), isTrue);
      expect(payload['ai_provider'], isNull);
    });

    test(
      'the checklist is serialised as a list of objects, not as a string',
      () {
        final Map<String, Object?> payload = _insert(
          checklist: _checklist(<ChecklistStatus>[ChecklistStatus.fail]),
        );

        final Object? data = payload['checklist_data'];
        expect(data, isA<List<Object?>>());
        expect((data! as List<Object?>).single, <String, Object?>{
          'id': 'item-0',
          'question': 'Question 0',
          'status': 'fail',
        });
      },
    );

    test('status is derived from the checklist, not passed in', () {
      expect(
        _insert(
          checklist: _checklist(<ChecklistStatus>[ChecklistStatus.fail]),
        )['status'],
        InspectionStatus.actionRequired.wire,
      );
      expect(
        _insert(
          checklist: _checklist(<ChecklistStatus>[ChecklistStatus.pass]),
        )['status'],
        InspectionStatus.safe.wire,
      );
    });
  });

  group('buildCorrectiveActionInsert', () {
    Map<String, Object?> action({
      String description =
          'Gauge reads low; extinguisher removed from service.',
      String severity = 'major',
      String? checklistItemId,
      String? defectPhotoPath,
      DateTime? dueDate,
    }) => buildCorrectiveActionInsert(
      organizationId: _org,
      inspectionId: 42,
      description: description,
      severity: severity,
      checklistItemId: checklistItemId,
      defectPhotoPath: defectPhotoPath,
      dueDate: dueDate,
    );

    test(
      'DEF-023: the photo column is defect_photo_url and photo_url is absent',
      () {
        final Map<String, Object?> payload = action(
          defectPhotoPath: 'org/defect.jpg',
        );

        // The web form has always sent `photo_url`, which no schema has ever had, so every
        // corrective action with a photo failed to insert. The defect photo is evidence of the
        // PROBLEM; `resolution_photo_url` is evidence of the FIX. They are different columns.
        expect(payload['defect_photo_url'], 'org/defect.jpg');
        expect(payload.containsKey('photo_url'), isFalse);
      },
    );

    test('status is omitted so the database default applies', () {
      // Sending it would let a client choose 'resolved', and `resolution_is_evidenced` would
      // then reject the row for a reason the UI never asked about.
      expect(action().containsKey('status'), isFalse);
    });

    test('an empty or whitespace-only description is refused', () {
      expect(() => action(description: ''), throwsArgumentError);
      expect(() => action(description: '   \n '), throwsArgumentError);
    });

    test(
      'the description is trimmed and capped at the 5000 the column accepts',
      () {
        expect(
          action(description: '  needs a new pin  ')['description'],
          'needs a new pin',
        );
        expect(
          (action(description: 'x' * 9000)['description']! as String).length,
          5000,
        );
      },
    );

    test('the due date is sent as a bare date, not a timestamp', () {
      // The column is DATE. Sending a full ISO-8601 instant makes the stored value depend on
      // the device time zone, so an action due "today" can land yesterday for a technician
      // west of UTC.
      final Map<String, Object?> payload = action(
        dueDate: DateTime(2026, 10, 1, 23, 30),
      );

      expect(payload['due_date'], '2026-10-01');
    });

    test('no due date is null, not an empty string', () {
      expect(action().containsKey('due_date'), isTrue);
      expect(action()['due_date'], isNull);
    });

    test('the checklist item is carried through, so an action can be traced to its failure', () {
      // This is what the inspection detail screen uses to work out which failed items still
      // have no action against them.
      expect(
        action(checklistItemId: 'pressure')['checklist_item_id'],
        'pressure',
      );
      expect(action()['checklist_item_id'], isNull);
    });

    test('the inspection id and organisation are always carried', () {
      final Map<String, Object?> payload = action();

      expect(payload['inspection_id'], 42);
      expect(payload['organization_id'], _org);
    });
  });
}
