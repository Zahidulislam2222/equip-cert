/// The `/api/analyze` client.
///
/// ---------------------------------------------------------------------------------------
/// WHY THE MODEL IS NOT NAMED HERE
///
/// This app never chooses a provider or a model, and it never learns which one ran until the
/// server tells it. The provider, the model id, the API version and the key all live in
/// server-only configuration that no `--dart-define` mirrors. An APK can be unzipped and its
/// constants read, so anything a client asserted about which AI produced a result would be
/// attacker-controlled — which is precisely what an AI Act Art. 50 provenance record must not
/// be.
///
/// So provenance arrives with the response and is VALIDATED at this boundary. See
/// `compliance/ai_provenance.dart`.
///
/// ---------------------------------------------------------------------------------------
/// THE BEARER TOKEN IS NOT OPTIONAL
///
/// `api/analyze.ts` rate-limits on `user:<id>` and rejects an unauthenticated call with 401 —
/// after DEF-034, where the handler skipped auth entirely when the Supabase environment was
/// missing and failed OPEN. The endpoint spends money per call, so an unauthenticated path is
/// somebody else's bill.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:meta/meta.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../compliance/ai_provenance.dart';
import '../config/app_config.dart';
import 'evidence_repository.dart';
import 'supabase_service.dart';

/// What the endpoint returns on success.
@immutable
class EquipmentAnalysis {
  const EquipmentAnalysis({
    required this.equipmentName,
    required this.serialNumber,
    required this.safetyStatus,
    required this.issues,
    required this.provenance,
  });

  final String equipmentName;
  final String serialNumber;
  final String safetyStatus;
  final List<String> issues;

  /// Null when the response carried no valid provenance.
  ///
  /// Null means "record no AI claim" — the safe direction. Under-claiming AI involvement is a
  /// formatting difference; over-claiming it, or claiming it with a provider we cannot name,
  /// puts an unverifiable statement onto a safety document.
  final AiProvenance? provenance;

  /// Every field is validated, never cast.
  ///
  /// `json['equipmentName'] as String` throws on a malformed payload and takes the inspection
  /// screen down with it — after the photo was taken, which is the expensive part.
  static EquipmentAnalysis fromJson(Map<String, Object?> json) {
    final Object? issues = json['issues'];

    return EquipmentAnalysis(
      equipmentName: _string(
        json['equipmentName'],
        fallback: 'Unidentified equipment',
      ),
      serialNumber: _string(json['serialNumber']),
      // Only the two values the `inspections.status` CHECK accepts. Anything else, including
      // a model that invented a third category, degrades to the cautious one.
      safetyStatus: switch (json['safetyStatus']) {
        'Safe' => 'Safe',
        _ => 'Action Required',
      },
      issues: issues is List
          ? issues
                .whereType<String>()
                .where((String s) => s.trim().isNotEmpty)
                .toList()
          : const <String>[],
      provenance: AiProvenance.tryParse(json['provenance']),
    );
  }

  static String _string(Object? value, {String fallback = ''}) {
    if (value is! String) return fallback;
    final String trimmed = value.trim();
    return trimmed.isEmpty ? fallback : trimmed;
  }
}

/// A failure the UI can explain.
class AnalyzeException implements Exception {
  const AnalyzeException(this.message, {this.retryable = true});

  final String message;
  final bool retryable;

  @override
  String toString() => message;
}

class AnalyzeApi {
  AnalyzeApi(this._client, {http.Client? httpClient})
    : _http = httpClient ?? http.Client();

  final SupabaseClient _client;
  final http.Client _http;

  /// False when no API origin was compiled in.
  ///
  /// `AppInfo.apiBaseUrl` is empty by default and is deliberately NOT defaulted to a localhost
  /// address: a phone cannot reach the developer's laptop, so a localhost default produces a
  /// connection error that reads like a broken AI provider. Empty lets the UI offer the manual
  /// checklist instead and say why.
  bool get isConfigured => AppInfo.apiBaseUrl.isNotEmpty;

  Future<EquipmentAnalysis> analyze({
    required Uint8List image,
    required EvidenceFormat format,
  }) async {
    if (!isConfigured) {
      throw const AnalyzeException(
        'AI analysis is not configured in this build. You can still complete the '
        'inspection manually.',
        retryable: false,
      );
    }

    final Session? session = _client.auth.currentSession;
    if (session == null) {
      throw const AnalyzeException(
        'Your session expired. Sign in again.',
        retryable: false,
      );
    }

    final Uri uri = Uri.parse('${AppInfo.apiBaseUrl}/api/analyze');

    final http.Response response;
    try {
      response = await _http
          .post(
            uri,
            headers: <String, String>{
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ${session.accessToken}',
            },
            body: jsonEncode(<String, Object?>{
              // The endpoint's schema takes bare base64, not a data URL.
              'image': base64Encode(image),
              'mimeType': format.mimeType,
            }),
          )
          .timeout(Duration(milliseconds: NetworkConfig.analyzeTimeoutMs));
    } catch (_) {
      throw const AnalyzeException(
        'Could not reach the analysis service. Check your connection, or complete the '
        'inspection manually.',
      );
    }

    return parseResponse(response);
  }

  /// Map one HTTP response to a result or an explainable failure.
  ///
  /// Exposed for testing for the same reason as `ChecklistRepository.parseResponse`: `analyze`
  /// returns early unless `AppInfo.apiBaseUrl` is non-empty, and that is a compile-time
  /// `--dart-define` that CI's bare `flutter test` does not set.
  @visibleForTesting
  EquipmentAnalysis parseResponse(http.Response response) {
    if (response.statusCode == 200) {
      final Object? decoded = jsonDecode(response.body);
      if (decoded is! Map<String, dynamic>) {
        throw const AnalyzeException(
          'The analysis service returned something unreadable.',
        );
      }
      return EquipmentAnalysis.fromJson(decoded);
    }

    // Mapped to what the technician should DO, not to the status code. The endpoint's own
    // error strings are for a developer.
    throw switch (response.statusCode) {
      401 => const AnalyzeException(
        'Your session expired. Sign in again.',
        retryable: false,
      ),
      429 => const AnalyzeException(
        'The analysis limit was reached. Wait a minute, or complete the inspection '
        'manually.',
      ),
      400 => const AnalyzeException(
        'That photo was rejected. Try a smaller or clearer picture.',
      ),
      500 || 503 => const AnalyzeException(
        'The analysis service is unavailable. You can complete the inspection manually.',
      ),
      _ => const AnalyzeException(
        'Analysis failed. You can complete the inspection manually.',
      ),
    };
  }

  void dispose() => _http.close();
}

final Provider<AnalyzeApi> analyzeApiProvider = Provider<AnalyzeApi>((Ref ref) {
  final AnalyzeApi api = AnalyzeApi(ref.watch(supabaseClientProvider));
  ref.onDispose(api.dispose);
  return api;
});
