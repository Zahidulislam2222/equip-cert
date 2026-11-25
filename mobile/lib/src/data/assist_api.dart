/// Client for the help assistant endpoint (`api/assist.ts`, global Rule 24).
///
/// The server owns retrieval, the prompt, the free-model allowlist, rate limits and the fallback
/// to a plain help article; this client sends the question with the user's JWT and renders what
/// comes back. Nothing is stored on the phone beyond the open conversation in memory.
library;

import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:meta/meta.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../config/app_config.dart';
import 'supabase_service.dart';

/// User-facing copy for the assistant. The owner is `src/content/assistant.json`; a released app
/// cannot read it, so these are copies that `test/assist_copy_contract_test.dart` compares.
class AssistCopy {
  const AssistCopy._();

  static const String disclosure =
      "You're chatting with an AI assistant. It answers from EquipCert's help articles and a "
      "read-only summary of your organisation's data, can make mistakes, and cannot change "
      'anything. Your questions are sent through OpenRouter to free AI models whose providers may '
      "retain them, so don't include personal or confidential details. EquipCert does not store "
      'the conversation.';

  static const String escalation =
      "Still stuck? Ask your organisation's administrator (see Team), or use the privacy "
      'request page for questions about your personal data.';

  static const List<String> suggestions = <String>[
    'How do I invite a technician?',
    "Why can't I edit a signed inspection?",
    'Which equipment is overdue?',
    'How does offline mode work?',
  ];
}

@immutable
class AssistTurn {
  const AssistTurn({required this.fromUser, required this.text});

  final bool fromUser;
  final String text;

  Map<String, String> toJson() => <String, String>{
    'role': fromUser ? 'user' : 'assistant',
    'content': text,
  };
}

@immutable
class AssistSource {
  const AssistSource({required this.title, required this.link});

  final String title;
  final String link;
}

@immutable
class AssistAnswer {
  const AssistAnswer({
    required this.text,
    required this.sources,
    required this.aiGenerated,
  });

  final String text;
  final List<AssistSource> sources;

  /// False when the server fell back to a help article because no model answered.
  final bool aiGenerated;

  static AssistAnswer? tryParse(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    final Object? answer = json['answer'];
    if (answer is! String || answer.trim().isEmpty) return null;
    final Object? sources = json['sources'];
    return AssistAnswer(
      text: answer.trim(),
      aiGenerated: json['aiGenerated'] == true,
      sources: sources is List
          ? sources
                .whereType<Map<String, dynamic>>()
                .where((Map<String, dynamic> s) => s['title'] is String)
                .map(
                  (Map<String, dynamic> s) => AssistSource(
                    title: s['title'] as String,
                    link: s['link'] is String ? s['link'] as String : '',
                  ),
                )
                .toList(growable: false)
          : const <AssistSource>[],
    );
  }
}

class AssistException implements Exception {
  const AssistException(this.message);

  final String message;

  @override
  String toString() => message;
}

class AssistApi {
  AssistApi(this._client, {http.Client? httpClient})
    : _http = httpClient ?? http.Client();

  final SupabaseClient _client;
  final http.Client _http;

  bool get isConfigured => AppInfo.apiBaseUrl.isNotEmpty;

  Future<AssistAnswer> ask(String question, List<AssistTurn> history) async {
    if (!isConfigured) {
      throw const AssistException(
        'The help assistant is not configured in this build.',
      );
    }
    final Session? session = _client.auth.currentSession;
    if (session == null) {
      throw const AssistException('Your session expired. Sign in again.');
    }
    final http.Response response;
    try {
      response = await _http
          .post(
            Uri.parse('${AppInfo.apiBaseUrl}/api/assist'),
            headers: <String, String>{
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ${session.accessToken}',
            },
            body: jsonEncode(<String, Object?>{
              'question': question,
              'history': history
                  .map((AssistTurn t) => t.toJson())
                  .toList(growable: false),
            }),
          )
          .timeout(Duration(milliseconds: NetworkConfig.assistTimeoutMs));
    } catch (_) {
      throw const AssistException(
        'Could not reach the help assistant. Check your connection.',
      );
    }
    return parseResponse(response);
  }

  @visibleForTesting
  AssistAnswer parseResponse(http.Response response) {
    if (response.statusCode == 200) {
      final AssistAnswer? answer = AssistAnswer.tryParse(
        jsonDecode(response.body),
      );
      if (answer == null) {
        throw const AssistException(
          'The help assistant returned something unreadable.',
        );
      }
      return answer;
    }
    throw switch (response.statusCode) {
      401 ||
      403 => const AssistException('Your session expired. Sign in again.'),
      429 => const AssistException(
        "You've asked a lot of questions in a short time. Try again later.",
      ),
      400 => const AssistException(
        'Ask a shorter question (up to 1,000 characters).',
      ),
      _ => const AssistException(
        'The help assistant is unavailable right now. Try again later.',
      ),
    };
  }

  void dispose() => _http.close();
}

final Provider<AssistApi> assistApiProvider = Provider<AssistApi>((Ref ref) {
  final AssistApi api = AssistApi(ref.watch(supabaseClientProvider));
  ref.onDispose(api.dispose);
  return api;
});
