/// Reads and writes for the inspection record and everything hanging off it.
///
/// The insert payload is built by a PURE FUNCTION, [buildInspectionInsert], deliberately
/// separated from the repository that sends it. Three things fall out of that:
///
///   * `mobile/test/schema_contract_test.dart` can check every column name it produces
///     against the migrations, which is the gate DEF-023 did not have.
///   * The two database CHECK constraints — `ai_provenance_is_complete` and
///     `location_is_a_pair` — can be unit-tested without a database.
///   * The offline queue serialises exactly the same map the online path sends, so a queued
///     submission cannot drift from a live one. That is the bug class the web client's
///     separate offline path invites.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:meta/meta.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../compliance/ai_provenance.dart';
import 'models.dart';
import 'supabase_service.dart';

/// A latitude/longitude pair.
///
/// The type exists to make `location_is_a_pair` unrepresentable in the wrong state. The
/// constraint is:
///
/// ```sql
/// CONSTRAINT location_is_a_pair CHECK ((location_lat IS NULL) = (location_lng IS NULL))
/// ```
///
/// Two nullable doubles threaded through a widget tree WILL eventually be half-populated —
/// a GPS fix that returns latitude and times out before longitude, a partially-restored draft.
/// One nullable object cannot be.
@immutable
class GeoPoint {
  const GeoPoint({required this.latitude, required this.longitude});

  final double latitude;
  final double longitude;

  /// Null unless BOTH are present and in range.
  ///
  /// The column types are `NUMERIC(9,6)` with range CHECKs, so an out-of-range value is a
  /// constraint violation at insert time — after the photo has been uploaded and the
  /// signature captured, which is the worst possible moment to discover it.
  static GeoPoint? tryCreate(double? latitude, double? longitude) {
    if (latitude == null || longitude == null) return null;
    if (latitude.isNaN || longitude.isNaN) return null;
    if (latitude < -90 || latitude > 90) return null;
    if (longitude < -180 || longitude > 180) return null;
    return GeoPoint(latitude: latitude, longitude: longitude);
  }

  /// Rounded to the column's scale.
  ///
  /// `NUMERIC(9,6)` keeps six decimal places — about 11 cm, far finer than any phone GPS.
  /// Sending more precision than the column holds is not an error, but it does mean the value
  /// read back differs from the value sent, which makes an offline-sync integrity comparison
  /// fail for no real reason.
  double get lat => double.parse(latitude.toStringAsFixed(6));
  double get lng => double.parse(longitude.toStringAsFixed(6));
}

/// Build the `inspections` insert payload.
///
/// Every key here is a real column, and `schema_contract_test.dart` proves it against the
/// migrations rather than trusting this comment.
Map<String, Object?> buildInspectionInsert({
  required String organizationId,
  required String equipmentName,
  required String inspectorName,
  required List<ChecklistEntry> checklist,
  String? inspectorId,
  String? equipmentId,
  AiProvenance? provenance,
  String? photoPath,
  String? signaturePath,
  GeoPoint? location,
  String? locationAddress,
  Map<String, Object?> deviceInfo = const <String, Object?>{},
}) {
  if (organizationId.isEmpty) {
    throw ArgumentError.value(
      organizationId,
      'organizationId',
      'must not be empty',
    );
  }

  // Both columns are NOT NULL with `CHECK (length(btrim(x)) BETWEEN 1 AND 200)`. An empty
  // value is a constraint violation, not a blank field.
  final String equipment = _clampName(
    equipmentName,
    fallback: 'Unidentified equipment',
  );
  final String inspector = _clampName(
    inspectorName,
    fallback: 'Unknown inspector',
  );

  return <String, Object?>{
    'organization_id': organizationId,
    'inspector_id': inspectorId,
    'equipment_id': equipmentId,
    'equipment_name': equipment,

    // Always the human who signed. Naming the AI here would put a machine on a safety
    // document as the responsible inspector, which NFPA 10 and OSHA 1910.157(e) both require
    // to be a qualified person. AI involvement lives in the ai_* columns.
    'inspector_name': inspector,

    'status': statusFor(checklist).wire,
    'checklist_data': checklist
        .map((ChecklistEntry entry) => entry.toJson())
        .toList(growable: false),

    // PATHS, not URLs. DEF-017.
    'photo_url': photoPath,
    'signature_url': signaturePath,

    'location_lat': location?.lat,
    'location_lng': location?.lng,
    'location_address': locationAddress,

    'device_info': deviceInfo,

    // Spreads all four AI columns together or all four empty — never a partial set, which
    // `ai_provenance_is_complete` rejects.
    ...AiProvenance.toColumns(provenance),

    // `created_at` is deliberately absent. It is `DEFAULT now()`, server-generated: a
    // client-supplied inspection time is not evidence, because the device clock is under the
    // control of the person being audited.
  };
}

/// An inspection is "Action Required" if anything failed.
///
/// A pending item is NOT a pass. The submit button is disabled while any item is pending, so
/// this should never see one — but treating pending as passing would silently file an
/// incomplete inspection as safe, so it counts as unresolved instead.
InspectionStatus statusFor(List<ChecklistEntry> checklist) =>
    checklist.any(
      (ChecklistEntry entry) => entry.status != ChecklistStatus.pass,
    )
    ? InspectionStatus.actionRequired
    : InspectionStatus.safe;

String _clampName(String value, {required String fallback}) {
  final String trimmed = value.trim();
  if (trimmed.isEmpty) return fallback;
  return trimmed.length <= 200 ? trimmed : trimmed.substring(0, 200);
}

/// The `corrective_actions` insert payload.
///
/// `defect_photo_url` is the column, NOT `photo_url`. The web form has always sent `photo_url`
/// and no schema has ever had it, so every corrective action with a photo failed to insert
/// with `column "photo_url" does not exist` — DEF-023. The distinction is real: the defect
/// photo is evidence of the PROBLEM, `resolution_photo_url` is evidence of the FIX.
Map<String, Object?> buildCorrectiveActionInsert({
  required String organizationId,
  required int inspectionId,
  required String description,
  required String severity,
  String? checklistItemId,
  String? defectPhotoPath,
  DateTime? dueDate,
}) {
  final String text = description.trim();
  if (text.isEmpty) {
    throw ArgumentError.value(description, 'description', 'must not be empty');
  }

  return <String, Object?>{
    'organization_id': organizationId,
    'inspection_id': inspectionId,
    'checklist_item_id': checklistItemId,
    // `CHECK (length(btrim(description)) BETWEEN 1 AND 5000)`.
    'description': text.length <= 5000 ? text : text.substring(0, 5000),
    'severity': severity,
    'defect_photo_url': defectPhotoPath,
    'due_date': dueDate?.toIso8601String().split('T').first,
    // `status` is omitted so the column default ('open') applies. Sending it would let a
    // client choose 'resolved', and `resolution_is_evidenced` would then reject the row for a
    // reason the UI never asked about.
  };
}

class InspectionRepository {
  InspectionRepository(this._client);

  final SupabaseClient _client;

  /// File an inspection and return its server-assigned id.
  ///
  /// The id is needed immediately: a failed checklist item raises a corrective action, and
  /// `corrective_actions.inspection_id` is `NOT NULL REFERENCES inspections(id)`. The web
  /// client gets this wrong — its corrective-action form is mounted only when
  /// `submittedInspectionId` is set, which happens inside the same handler that then unmounts
  /// the screen, so the form is unreachable and a failed item can never produce an action
  /// (DEF-043). Here the id is returned and the caller raises the action afterwards.
  Future<int> submit(Map<String, Object?> payload) async {
    final Map<String, dynamic> row = await _client
        .from('inspections')
        .insert(payload)
        .select('id')
        .single();

    final Object? id = row['id'];
    if (id is int) return id;
    if (id is num) return id.toInt();
    throw StateError(
      'The inspection was filed but the database returned no id.',
    );
  }

  Future<void> raiseCorrectiveAction(Map<String, Object?> payload) =>
      _client.from('corrective_actions').insert(payload);

  /// Recent inspections for the caller's organisation.
  ///
  /// No `organization_id` filter is applied, and that is not an oversight: RLS scopes every
  /// row to the caller's tenant server-side. Adding a client-side filter would suggest the
  /// isolation depends on the client remembering to ask, which is the opposite of true.
  /// `idx_inspections_org_created` serves this ordering directly.
  Future<List<Inspection>> recent({int limit = 50}) async {
    final List<Map<String, dynamic>> rows = await _client
        .from('inspections')
        .select()
        .order('created_at', ascending: false)
        .limit(limit);

    return rows.map(Inspection.fromJson).toList(growable: false);
  }

  Future<Inspection?> byId(int id) async {
    final Map<String, dynamic>? row = await _client
        .from('inspections')
        .select()
        .eq('id', id)
        .maybeSingle();
    return row == null ? null : Inspection.fromJson(row);
  }

  /// Equipment due for inspection, soonest first.
  ///
  /// Retired and out-of-service assets are excluded: they are not inspectable, and a
  /// technician's list of work should not contain items they must skip. `idx_equipment_due` is
  /// partial on `status = 'active'`, so this is the query it was built for.
  Future<List<Equipment>> equipmentDue({int limit = 100}) async {
    final List<Map<String, dynamic>> rows = await _client
        .from('equipment')
        .select()
        .eq('status', 'active')
        .order('next_due_date', ascending: true, nullsFirst: false)
        .limit(limit);

    return rows.map(Equipment.fromJson).toList(growable: false);
  }

  Future<Equipment?> equipmentById(String id) async {
    final Map<String, dynamic>? row = await _client
        .from('equipment')
        .select()
        .eq('id', id)
        .maybeSingle();
    return row == null ? null : Equipment.fromJson(row);
  }

  /// Everything still outstanding, oldest due date first.
  Future<List<CorrectiveAction>> openCorrectiveActions({
    int limit = 100,
  }) async {
    final List<Map<String, dynamic>> rows = await _client
        .from('corrective_actions')
        .select()
        .inFilter('status', <String>['open', 'in_progress', 'overdue'])
        .order('due_date', ascending: true, nullsFirst: false)
        .limit(limit);

    return rows.map(CorrectiveAction.fromJson).toList(growable: false);
  }

  Future<List<CorrectiveAction>> correctiveActionsFor(int inspectionId) async {
    final List<Map<String, dynamic>> rows = await _client
        .from('corrective_actions')
        .select()
        .eq('inspection_id', inspectionId)
        .order('created_at', ascending: false);

    return rows.map(CorrectiveAction.fromJson).toList(growable: false);
  }
}

final Provider<InspectionRepository> inspectionRepositoryProvider =
    Provider<InspectionRepository>(
      (Ref ref) => InspectionRepository(ref.watch(supabaseClientProvider)),
    );
