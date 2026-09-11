/// The inspection checklist, from Contentful, with a fallback that is not empty.
///
/// ---------------------------------------------------------------------------------------
/// WHY A FALLBACK EXISTS AT ALL
///
/// The web client fetches the checklist from Contentful and, if the request fails, logs to the
/// console and leaves the list EMPTY. An empty checklist is not a degraded inspection — it is
/// a screen with nothing to answer and a submit button that files a record asserting nothing
/// was checked.
///
/// This app is used where the network is worst. So a failed fetch falls back to the NFPA 10
/// monthly quick-check items, which are a real standard rather than a placeholder, and the UI
/// states plainly which one it is showing. A technician can then decide whether to proceed;
/// that decision is theirs and they can only make it if they are told.
///
/// ---------------------------------------------------------------------------------------
/// CACHING
///
/// A successful fetch is cached in memory for the session. Checklists change when a content
/// editor changes them — measured in months — and re-fetching per inspection is a round trip
/// the technician waits on, every time, on the worst connection in the building.
library;

import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:meta/meta.dart';

import '../config/app_config.dart';
import 'models.dart';

/// Where a checklist came from. The UI says which.
enum ChecklistSource {
  /// Matched a Contentful entry for this equipment type.
  contentful,

  /// Contentful was reachable but had nothing matching; its first entry was used.
  contentfulGeneric,

  /// Contentful was unreachable or unconfigured.
  fallback,
}

@immutable
class ChecklistResult {
  const ChecklistResult({required this.entries, required this.source});

  final List<ChecklistEntry> entries;
  final ChecklistSource source;

  bool get isFallback => source == ChecklistSource.fallback;
}

class ChecklistRepository {
  ChecklistRepository({http.Client? client}) : _http = client ?? http.Client();

  final http.Client _http;
  final Map<String, ChecklistResult> _cache = <String, ChecklistResult>{};

  /// NFPA 10 §7.2 monthly inspection points.
  ///
  /// Content, not code — but it lives here rather than in a JSON asset for one reason: it is
  /// the LAST RESORT. A fallback that itself has to be loaded from somewhere can fail to
  /// load, which defeats the purpose of being a fallback.
  static const List<String> nfpa10MonthlyChecks = <String>[
    'Extinguisher is in its designated place and is unobstructed',
    'Access to and visibility of the extinguisher is not impaired',
    'Operating instructions on the nameplate face outward and are legible',
    'Safety seals and tamper indicators are intact',
    'The unit is full — verified by weight or by lifting',
    'No obvious physical damage, corrosion, leakage or clogged nozzle',
    'Pressure gauge reading is in the operable range',
    'The inspection record tag is present and up to date',
  ];

  static ChecklistResult get fallbackChecklist => ChecklistResult(
    entries: _toEntries(nfpa10MonthlyChecks),
    source: ChecklistSource.fallback,
  );

  /// Fetch the checklist for a piece of equipment.
  ///
  /// Never throws and never returns an empty list — see the file comment.
  Future<ChecklistResult> forEquipment(String equipmentName) async {
    final String key = equipmentName.trim().toLowerCase();
    final ChecklistResult? cached = _cache[key];
    if (cached != null) return cached;

    if (!ContentfulConfig.isConfigured) return fallbackChecklist;

    try {
      final Uri uri = Uri.parse(
        '${ContentfulConfig.baseUrl}/spaces/${ContentfulConfig.spaceId}'
        '/environments/${ContentfulConfig.environment}/entries'
        '?content_type=${ContentfulConfig.contentType}&include=2',
      );

      final http.Response response = await _http
          .get(
            uri,
            headers: <String, String>{
              'Authorization': 'Bearer ${ContentfulConfig.accessToken}',
            },
          )
          .timeout(Duration(milliseconds: ContentfulConfig.timeoutMs));

      if (response.statusCode != 200) return fallbackChecklist;

      final ChecklistResult result = parseResponse(
        response.body,
        equipmentName,
      );
      if (result.entries.isEmpty) return fallbackChecklist;

      _cache[key] = result;
      return result;
    } catch (_) {
      // Every failure mode lands here on purpose: timeout, DNS, TLS, malformed JSON. None of
      // them should produce an inspection with no questions.
      return fallbackChecklist;
    }
  }

  /// Match an entry to the equipment, and read its questions.
  ///
  /// Exposed for testing. `forEquipment` reaches this only when `ContentfulConfig.isConfigured`
  /// is true, and that is a compile-time `--dart-define` which CI's bare `flutter test` never
  /// sets — so through the public API this entire branch is unreachable in a test and the most
  /// intricate parsing in the class would go unverified forever.
  ///
  /// Contentful's Delivery API returns links as `sys.id` references with the linked entries in
  /// `includes.Entry`, so the equipment type has to be resolved through that side table rather
  /// than read inline. The web client's version calls `.getEntries()` with `include: 2`, which
  /// makes the SDK do the same resolution invisibly.
  @visibleForTesting
  ChecklistResult parseResponse(String body, String equipmentName) {
    // Decoding is guarded rather than left to the caller's blanket catch. `forEquipment` would
    // have turned a FormatException into the fallback anyway, so behaviour is unchanged — but
    // a method documented as never returning an empty checklist should not be able to throw
    // its way out of that promise, and the sibling `AnalyzeApi` validates rather than casts.
    final Object? decoded;
    try {
      decoded = jsonDecode(body);
    } on FormatException {
      return fallbackChecklist;
    }
    if (decoded is! Map<String, Object?>) return fallbackChecklist;

    // Checked, not cast. `decoded['items'] as List<Object?>?` throws a TypeError if the space
    // ever returns an object here, which is a different failure mode reaching the same
    // fallback by accident.
    final Object? rawItems = decoded['items'];
    final List<Object?> items = rawItems is List<Object?>
        ? rawItems
        : const <Object?>[];
    if (items.isEmpty) return fallbackChecklist;

    final Map<String, Map<String, Object?>> included = _includedEntries(
      decoded,
    );
    final String needle = equipmentName.toLowerCase();

    Map<String, Object?>? matched;
    for (final Object? item in items) {
      if (item is! Map<String, Object?>) continue;
      final String typeName = _linkedTypeName(item, included).toLowerCase();
      if (typeName.isEmpty) continue;

      // Two-way containment, matching the web client: an entry named "Extinguisher" should
      // match equipment called "CO2 Extinguisher 5kg", and vice versa.
      if (needle.contains(typeName) || typeName.contains(needle)) {
        matched = item;
        break;
      }
    }

    final Map<String, Object?>? entry =
        matched ??
        (items.first is Map<String, Object?>
            ? items.first as Map<String, Object?>
            : null);
    if (entry == null) return fallbackChecklist;

    final List<String> questions = _questions(entry);
    if (questions.isEmpty) return fallbackChecklist;

    return ChecklistResult(
      entries: _toEntries(questions),
      source: matched != null
          ? ChecklistSource.contentful
          : ChecklistSource.contentfulGeneric,
    );
  }

  Map<String, Map<String, Object?>> _includedEntries(
    Map<String, Object?> body,
  ) {
    final Object? includes = body['includes'];
    if (includes is! Map<String, Object?>) {
      return const <String, Map<String, Object?>>{};
    }

    final Object? entries = includes['Entry'];
    if (entries is! List<Object?>) {
      return const <String, Map<String, Object?>>{};
    }

    final Map<String, Map<String, Object?>> byId =
        <String, Map<String, Object?>>{};
    for (final Object? entry in entries) {
      if (entry is! Map<String, Object?>) continue;
      final Object? sys = entry['sys'];
      if (sys is! Map<String, Object?>) continue;
      final Object? id = sys['id'];
      if (id is String) byId[id] = entry;
    }
    return byId;
  }

  String _linkedTypeName(
    Map<String, Object?> item,
    Map<String, Map<String, Object?>> included,
  ) {
    final Object? fields = item['fields'];
    if (fields is! Map<String, Object?>) return '';

    final Object? link = fields['equipmentType'];
    if (link is! Map<String, Object?>) return '';

    // Already resolved inline (some SDK shapes do this).
    final Object? inlineFields = link['fields'];
    if (inlineFields is Map<String, Object?> &&
        inlineFields['name'] is String) {
      return inlineFields['name']! as String;
    }

    final Object? sys = link['sys'];
    if (sys is! Map<String, Object?>) return '';
    final Object? id = sys['id'];
    if (id is! String) return '';

    final Object? linkedFields = included[id]?['fields'];
    if (linkedFields is! Map<String, Object?>) return '';
    final Object? name = linkedFields['name'];
    return name is String ? name : '';
  }

  /// `fields.questions` is either a list or an object wrapping one.
  ///
  /// Both shapes are handled because both exist in this space — the web client carries the
  /// same branch. Each question may be `{text: ...}`, `{question: ...}` or a bare string.
  List<String> _questions(Map<String, Object?> entry) {
    final Object? fields = entry['fields'];
    if (fields is! Map<String, Object?>) return const <String>[];

    Object? raw = fields['questions'];
    if (raw is Map<String, Object?>) raw = raw['questions'];
    if (raw is! List<Object?>) return const <String>[];

    final List<String> questions = <String>[];
    for (final Object? question in raw) {
      final String text = switch (question) {
        final String value => value,
        final Map<String, Object?> value =>
          (value['text'] ?? value['question'] ?? '').toString(),
        _ => '',
      };
      if (text.trim().isNotEmpty) questions.add(text.trim());
    }
    return questions;
  }

  static List<ChecklistEntry> _toEntries(List<String> questions) =>
      List<ChecklistEntry>.generate(
        questions.length,
        (int index) => ChecklistEntry(
          // 1-based string ids, matching what the web client writes into `checklist_data`.
          // Changing the shape would make old and new records disagree in the same column.
          id: '${index + 1}',
          question: questions[index],
          status: ChecklistStatus.pending,
        ),
        growable: false,
      );

  void dispose() => _http.close();
}

final Provider<ChecklistRepository> checklistRepositoryProvider =
    Provider<ChecklistRepository>((Ref ref) {
      final ChecklistRepository repository = ChecklistRepository();
      ref.onDispose(repository.dispose);
      return repository;
    });
