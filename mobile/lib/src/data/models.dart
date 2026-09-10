/// Row shapes, typed against the applied migrations.
///
/// ---------------------------------------------------------------------------------------
/// WHY THESE ARE HAND-WRITTEN AND WHAT KEEPS THEM HONEST
///
/// The web client generates `src/lib/database.types.ts` from the live schema with
/// `npm run gen:types`, and `npm run test:types` fails CI when it drifts. Dart has no
/// equivalent generator pointed at Supabase, so these are written by hand — which is exactly
/// the practice that caused DEF-023 on the web side (a form inserting a `photo_url` column no
/// schema ever had, invisible to every gate).
///
/// So the same protection is rebuilt differently: `mobile/test/schema_contract_test.dart`
/// parses `supabase/migrations/*.sql` and asserts that every column named here exists with
/// the nullability claimed. A column rename then fails a test instead of failing at runtime
/// for whoever happened to be offline that day.
///
/// ---------------------------------------------------------------------------------------
/// EVERY PARSE IS DEFENSIVE
///
/// These objects are built from JSON that crossed a network. A row written by an older client
/// version, a partially-synced record, or a column that became nullable will otherwise throw
/// inside a list builder and take down a screen showing a hundred other perfectly good rows.
/// Missing optional data degrades; missing REQUIRED data throws, loudly, because an
/// inspection with no id is not a record.
library;

import 'package:meta/meta.dart';

/// Roles, matching the `CHECK (role IN (...))` on `profiles`.
enum UserRole {
  admin,
  manager,
  technician;

  static UserRole parse(Object? value) => switch (value) {
    'admin' => UserRole.admin,
    'manager' => UserRole.manager,
    // Unknown roles fall back to the LEAST privileged, never the most. A future role this
    // build has not heard of must not be granted admin because the string did not match.
    _ => UserRole.technician,
  };

  String get wire => name;

  bool get isManager => this == UserRole.admin || this == UserRole.manager;
  bool get isAdmin => this == UserRole.admin;
}

/// Inspection outcome, matching `CHECK (status IN ('Safe', 'Action Required'))`.
///
/// The wire values are capitalised with a space — that is what the constraint accepts, and it
/// is not negotiable from this side.
enum InspectionStatus {
  safe('Safe'),
  actionRequired('Action Required');

  const InspectionStatus(this.wire);
  final String wire;

  static InspectionStatus parse(Object? value) => value == 'Action Required'
      ? InspectionStatus.actionRequired
      : InspectionStatus.safe;
}

/// One checklist row, as stored in the `checklist_data` jsonb column.
///
/// `pending` is a UI-only state: an inspection cannot be submitted while any item is pending,
/// so a persisted row should never contain one. It is still parsed rather than rejected,
/// because a queued offline submission is serialised mid-flight and does contain them.
enum ChecklistStatus {
  pending,
  pass,
  fail;

  static ChecklistStatus parse(Object? value) => switch (value) {
    'pass' => ChecklistStatus.pass,
    'fail' => ChecklistStatus.fail,
    _ => ChecklistStatus.pending,
  };
}

@immutable
class ChecklistEntry {
  const ChecklistEntry({
    required this.id,
    required this.question,
    this.status = ChecklistStatus.pending,
  });

  final String id;
  final String question;
  final ChecklistStatus status;

  ChecklistEntry copyWith({ChecklistStatus? status}) =>
      ChecklistEntry(id: id, question: question, status: status ?? this.status);

  Map<String, Object?> toJson() => <String, Object?>{
    'id': id,
    'question': question,
    'status': status.name,
  };

  static ChecklistEntry? tryParse(Object? value) {
    if (value is! Map) return null;
    final Object? id = value['id'];
    final Object? question = value['question'];
    if (id is! String || question is! String) return null;
    return ChecklistEntry(
      id: id,
      question: question,
      status: ChecklistStatus.parse(value['status']),
    );
  }

  /// Parse a whole `checklist_data` column.
  ///
  /// A malformed checklist yields an empty list and the record still renders, rather than
  /// taking the page down — the same decision `asChecklist()` makes in `src/lib/db.ts`.
  /// Postgres does not constrain what is inside a jsonb column, so "it is an array of these"
  /// is an assumption until it is checked.
  static List<ChecklistEntry> parseList(Object? value) {
    if (value is! List) return const <ChecklistEntry>[];
    return value
        .map(ChecklistEntry.tryParse)
        .whereType<ChecklistEntry>()
        .toList(growable: false);
  }
}

@immutable
class Organization {
  const Organization({
    required this.id,
    required this.name,
    required this.slug,
    required this.plan,
    required this.retentionMonths,
  });

  final String id;
  final String name;
  final String slug;
  final String plan;

  /// NFPA 10 §7.2.2.6 sets the floor at 12 months for monthly inspection records; a customer
  /// may contractually need longer. The DB constrains this to 12..600.
  final int retentionMonths;

  static Organization fromJson(Map<String, Object?> json) => Organization(
    id: json['id']! as String,
    name: json['name'] as String? ?? '',
    slug: json['slug'] as String? ?? '',
    plan: json['plan'] as String? ?? 'free',
    retentionMonths: (json['retention_months'] as num?)?.toInt() ?? 12,
  );
}

@immutable
class Profile {
  const Profile({
    required this.id,
    required this.userId,
    required this.orgId,
    required this.fullName,
    required this.role,
    this.qualifications,
    this.anonymizedAt,
  });

  final String id;
  final String userId;
  final String orgId;
  final String fullName;
  final UserRole role;

  /// Free text. Appears in the inspection's `device_info` because OSHA 1910.157(e) requires
  /// the inspection to have been performed by a qualified person.
  final String? qualifications;

  /// Set when the subject exercised GDPR erasure. The row survives so inspection records keep
  /// a stable foreign key, but every identifying field is scrubbed.
  final String? anonymizedAt;

  bool get isAnonymized => anonymizedAt != null;

  /// First name, for the greeting. Empty-safe: `''.split(' ').first` is `''`, not a throw.
  String get firstName => fullName.split(' ').first;

  static Profile fromJson(Map<String, Object?> json) => Profile(
    id: json['id']! as String,
    userId: json['user_id']! as String,
    orgId: json['org_id']! as String,
    fullName: json['full_name'] as String? ?? '',
    role: UserRole.parse(json['role']),
    qualifications: json['qualifications'] as String?,
    anonymizedAt: json['anonymized_at'] as String?,
  );
}

@immutable
class Equipment {
  const Equipment({
    required this.id,
    required this.organizationId,
    required this.name,
    required this.status,
    this.type,
    this.serialNumber,
    this.location,
    this.photoUrl,
    this.nextDueDate,
    this.lastInspectionDate,
  });

  final String id;
  final String organizationId;
  final String name;

  /// `active` | `out_of_service` | `retired`.
  final String status;
  final String? type;
  final String? serialNumber;
  final String? location;

  /// A bucket-relative PATH, not a URL. See EvidenceRepository.
  final String? photoUrl;
  final DateTime? nextDueDate;
  final DateTime? lastInspectionDate;

  bool get isActive => status == 'active';

  /// Overdue is decided by DATE, not by timestamp: an inspection due today is not overdue
  /// at 00:01. Comparing raw DateTimes would mark it overdue for the whole day.
  bool get isOverdue {
    final DateTime? due = nextDueDate;
    if (due == null) return false;
    final DateTime today = DateTime.now();
    final DateTime midnight = DateTime(today.year, today.month, today.day);
    return due.isBefore(midnight);
  }

  bool get isDueToday {
    final DateTime? due = nextDueDate;
    if (due == null) return false;
    final DateTime today = DateTime.now();
    return due.year == today.year &&
        due.month == today.month &&
        due.day == today.day;
  }

  static Equipment fromJson(Map<String, Object?> json) => Equipment(
    id: json['id']! as String,
    organizationId: json['organization_id']! as String,
    name: json['name'] as String? ?? '',
    status: json['status'] as String? ?? 'active',
    type: json['type'] as String?,
    serialNumber: json['serial_number'] as String?,
    location: json['location'] as String?,
    photoUrl: json['photo_url'] as String?,
    nextDueDate: _date(json['next_due_date']),
    lastInspectionDate: _date(json['last_inspection_date']),
  );
}

@immutable
class Inspection {
  const Inspection({
    required this.id,
    required this.organizationId,
    required this.equipmentName,
    required this.inspectorName,
    required this.status,
    required this.checklist,
    required this.createdAt,
    required this.aiAssisted,
    this.aiProvider,
    this.aiModel,
    this.photoPath,
    this.signaturePath,
    this.locationAddress,
  });

  /// BIGINT identity in the schema, not a UUID. `corrective_actions.inspection_id` references
  /// it as BIGINT and the dashboard types it as a number, so it stays an int here.
  final int id;
  final String organizationId;
  final String equipmentName;

  /// A point-in-time snapshot of who inspected. Scrubbed by `app.anonymize_profile()` on
  /// erasure, which is how the record survives the person being erased.
  final String inspectorName;
  final InspectionStatus status;
  final List<ChecklistEntry> checklist;
  final DateTime createdAt;

  /// EU AI Act Art. 50 provenance. See compliance/ai_provenance.dart.
  final bool aiAssisted;
  final String? aiProvider;
  final String? aiModel;

  /// Bucket-relative PATHS into the private `evidence` bucket, never URLs (DEF-017).
  final String? photoPath;
  final String? signaturePath;
  final String? locationAddress;

  int get passedCount =>
      checklist.where((e) => e.status == ChecklistStatus.pass).length;
  int get failedCount =>
      checklist.where((e) => e.status == ChecklistStatus.fail).length;

  static Inspection fromJson(Map<String, Object?> json) => Inspection(
    id: (json['id']! as num).toInt(),
    organizationId: json['organization_id']! as String,
    equipmentName: json['equipment_name'] as String? ?? '',
    inspectorName: json['inspector_name'] as String? ?? '',
    status: InspectionStatus.parse(json['status']),
    checklist: ChecklistEntry.parseList(json['checklist_data']),
    createdAt: _date(json['created_at']) ?? DateTime.now(),
    aiAssisted: json['ai_assisted'] as bool? ?? false,
    aiProvider: json['ai_provider'] as String?,
    aiModel: json['ai_model'] as String?,
    photoPath: json['photo_url'] as String?,
    signaturePath: json['signature_url'] as String?,
    locationAddress: json['location_address'] as String?,
  );
}

@immutable
class CorrectiveAction {
  const CorrectiveAction({
    required this.id,
    required this.organizationId,
    required this.inspectionId,
    required this.description,
    required this.severity,
    required this.status,
    this.checklistItemId,
    this.dueDate,
    this.defectPhotoPath,
  });

  final String id;
  final String organizationId;
  final int inspectionId;
  final String description;

  /// `critical` | `major` | `minor`.
  final String severity;

  /// `open` | `in_progress` | `resolved` | `overdue`.
  final String status;
  final String? checklistItemId;
  final DateTime? dueDate;

  /// Evidence of the DEFECT, captured when the action is raised. Distinct from
  /// `resolution_photo_url`, which is evidence of the FIX. Conflating the two is what
  /// DEF-023 was.
  final String? defectPhotoPath;

  static CorrectiveAction fromJson(Map<String, Object?> json) =>
      CorrectiveAction(
        id: json['id']! as String,
        organizationId: json['organization_id']! as String,
        inspectionId: (json['inspection_id']! as num).toInt(),
        description: json['description'] as String? ?? '',
        severity: json['severity'] as String? ?? 'minor',
        status: json['status'] as String? ?? 'open',
        checklistItemId: json['checklist_item_id'] as String?,
        dueDate: _date(json['due_date']),
        defectPhotoPath: json['defect_photo_url'] as String?,
      );
}

/// Parse a Postgres date or timestamptz.
///
/// Returns null on anything unparseable instead of throwing. A record with an unreadable
/// timestamp should still be visible to the technician — losing the whole row because one
/// field is malformed loses the inspection evidence too.
DateTime? _date(Object? value) {
  if (value is! String || value.isEmpty) return null;
  return DateTime.tryParse(value)?.toLocal();
}
