/// The assistant's AI disclosure is a transparency obligation (Rule 24; EU AI Act Art. 50), so the
/// phone must say exactly what the web says. `src/content/assistant.json` owns the copy;
/// [AssistCopy] is the copy a released app carries. This test compares them, and checks how the
/// client reads the server's answers and errors.
library;

import 'dart:convert';
import 'dart:io';

import 'package:equipcert_mobile/src/data/assist_api.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

void main() {
  final Map<String, dynamic> owner = jsonDecode(
    File('../src/content/assistant.json').readAsStringSync(),
  ) as Map<String, dynamic>;

  group('copy matches src/content/assistant.json', () {
    test(
      'disclosure',
      () => expect(AssistCopy.disclosure, owner['disclosure']),
    );
    test(
      'escalation',
      () => expect(AssistCopy.escalation, owner['escalation']),
    );
    test(
      'suggestions',
      () => expect(AssistCopy.suggestions, owner['suggestions']),
    );
  });

  group('parseResponse', () {
    final AssistApi api = AssistApi(
      SupabaseClient('https://example.invalid', 'fake-anon-key'),
    );

    test('an AI answer keeps its sources', () {
      final AssistAnswer a = api.parseResponse(
        http.Response(
          jsonEncode(<String, Object?>{
            'answer': 'Open Team.',
            'aiGenerated': true,
            'sources': <Object?>[
              <String, Object?>{
                'id': 'x',
                'title': 'Inviting',
                'link': '/app/team',
              },
              'junk',
            ],
          }),
          200,
        ),
      );
      expect(a.text, 'Open Team.');
      expect(a.aiGenerated, isTrue);
      expect(a.sources.single.title, 'Inviting');
    });

    test('a fallback article is not labelled as AI', () {
      final AssistAnswer a = api.parseResponse(
        http.Response(
          jsonEncode(<String, Object?>{
            'answer': 'Article text',
            'fallback': true,
          }),
          200,
        ),
      );
      expect(a.aiGenerated, isFalse);
    });

    test('an empty answer is unreadable, not blank', () {
      expect(
        () => api.parseResponse(
          http.Response(jsonEncode(<String, Object?>{'answer': ' '}), 200),
        ),
        throwsA(isA<AssistException>()),
      );
    });

    test('a rate limit says to try later', () {
      expect(
        () => api.parseResponse(http.Response('{}', 429)),
        throwsA(
          isA<AssistException>().having(
            (AssistException e) => e.message,
            'message',
            contains('Try again later'),
          ),
        ),
      );
    });
  });
}
