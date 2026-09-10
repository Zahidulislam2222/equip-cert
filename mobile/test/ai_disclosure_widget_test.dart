/// EU AI Act Article 50(1) — acceptance criterion D7.
///
/// ---------------------------------------------------------------------------------------
/// WHAT IS BEING TESTED, AND WHY IT IS A WIDGET TEST
///
/// Art. 50(1) has been binding since 2 August 2026, with no grace period: a person interacting
/// with an AI system must be informed that they are. "Informed" is not satisfied by a string
/// existing somewhere in the codebase — it is satisfied by pixels the technician sees before
/// they act. Three properties follow, and every one of them is a rendering property:
///
///   1. It renders whenever provenance is present, and renders NOTHING when it is not.
///   2. It is not dismissible — no close control, and no tap that makes it go away.
///   3. It appears ABOVE the checklist, before the answers it influenced.
///
/// A unit test on a data class cannot check any of those. Hence this file.
///
/// ---------------------------------------------------------------------------------------
/// THE HONEST LIMIT OF PROPERTY 3
///
/// The strongest possible test would pump the real `InspectScreen` and compare two `dy`
/// values. It cannot be done here: that screen resolves Riverpod repositories that call
/// `Supabase.instance`, plus go_router and the geolocator/image_picker platform channels, none
/// of which exist in a `flutter test` VM. Standing a fake in for every one of them would build
/// a second screen and then test THAT.
///
/// So property 3 is covered from two sides, and neither is pretended to be the other:
///
///   * GEOMETRICALLY, in a real pump: the widget must lay out in normal document flow, above a
///     following sibling. This is what fails if someone reimplements it as an `Overlay`, a
///     `Positioned`, or a bottom sheet — any of which would put the disclosure below or over
///     the content no matter what order the source says.
///   * STRUCTURALLY, by reading `inspect_screen.dart`: the caller must place it before the
///     'Checklist' heading. This is what fails if someone moves the call site down.
///
/// Neither alone is sufficient. Together they cover the two ways the ordering actually breaks.
library;

import 'dart:io';

import 'package:equipcert_mobile/src/compliance/ai_provenance.dart';
import 'package:equipcert_mobile/src/theme/app_theme.dart';
import 'package:equipcert_mobile/src/widgets/ai_disclosure.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Fixtures are deliberately fake. Rule 12 forbids a real model id in a test, and
/// `npm run test:config` fails the build if one appears here.
const AiProvenance _provenance = AiProvenance(
  provider: 'test-provider-one',
  model: 'test-model-alpha',
  disclosedAt: '2026-09-11T10:00:00.000Z',
);

/// The disclosure inside a real MaterialApp with the app's own theme, because
/// `colorsOf(context)` reads a theme extension and would throw under a bare `Theme`.
Widget _host(Widget child, {double width = 400}) => MaterialApp(
  theme: AppTheme.dark,
  home: Scaffold(
    body: SingleChildScrollView(
      child: SizedBox(width: width, child: child),
    ),
  ),
);

void main() {
  group('it renders exactly when there is something to disclose', () {
    testWidgets('provenance present -> the notice is on screen', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        _host(const AiDisclosure(provenance: _provenance)),
      );

      expect(find.textContaining('AI-assisted result'), findsOneWidget);
    });

    testWidgets('provenance null -> nothing at all is rendered', (
      WidgetTester tester,
    ) async {
      // A disclosure shown where no AI was involved trains people to ignore the real one.
      await tester.pumpWidget(_host(const AiDisclosure(provenance: null)));

      expect(find.textContaining('AI-assisted'), findsNothing);
      expect(find.byType(Container), findsNothing);
    });

    testWidgets('the null case occupies no vertical space', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(_host(const AiDisclosure(provenance: null)));

      expect(tester.getSize(find.byType(AiDisclosure)).height, 0);
    });

    testWidgets('the present case occupies real vertical space', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        _host(const AiDisclosure(provenance: _provenance)),
      );

      expect(tester.getSize(find.byType(AiDisclosure)).height, greaterThan(40));
    });
  });

  group('it names the actual system, not "this app uses AI"', () {
    testWidgets('the provider appears in the rendered text', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        _host(const AiDisclosure(provenance: _provenance)),
      );

      expect(find.textContaining('test-provider-one'), findsOneWidget);
    });

    testWidgets('the model appears in the rendered text', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        _host(const AiDisclosure(provenance: _provenance)),
      );

      expect(find.textContaining('test-model-alpha'), findsOneWidget);
    });

    testWidgets('a different provenance renders different text', (
      WidgetTester tester,
    ) async {
      // Guards against the attribution being a hardcoded string that merely looks dynamic.
      await tester.pumpWidget(
        _host(
          const AiDisclosure(
            provenance: AiProvenance(
              provider: 'test-provider-two',
              model: 'test-model-beta',
              disclosedAt: '2026-09-11T10:00:00.000Z',
            ),
          ),
        ),
      );

      expect(find.textContaining('test-provider-two'), findsOneWidget);
      expect(find.textContaining('test-model-beta'), findsOneWidget);
      expect(find.textContaining('test-provider-one'), findsNothing);
    });

    testWidgets('it says the inspector decides, not the AI', (
      WidgetTester tester,
    ) async {
      // Not boilerplate. This sentence is the difference between a tool that assists a
      // qualified inspector and one that makes the determination — and that distinction is
      // the whole Annex III high-risk classification argument. A UI presenting the AI result
      // as the finding would make the classification document false.
      await tester.pumpWidget(
        _host(const AiDisclosure(provenance: _provenance)),
      );

      expect(
        find.textContaining('your answers are what get recorded'),
        findsOneWidget,
      );
      expect(find.textContaining('inspector of record'), findsOneWidget);
    });

    testWidgets('it is announced to a screen reader as ONE node, not three', (
      WidgetTester tester,
    ) async {
      // Split across separate nodes, a screen-reader user gets "AI", "test-provider-one",
      // "test-model-alpha" as three unrelated utterances, with no statement connecting them —
      // which is not a disclosure. `container: true` merges them, so ONE node must carry the
      // heading, the attribution and the who-decides sentence together.
      //
      // Asserted on the node's own label rather than with `find.bySemanticsLabel`, which
      // compares a String for EQUALITY and would fail against a correctly merged label.
      final SemanticsHandle handle = tester.ensureSemantics();
      await tester.pumpWidget(
        _host(const AiDisclosure(provenance: _provenance)),
      );

      final String label = tester.getSemantics(find.byType(AiDisclosure)).label;

      expect(label, startsWith('AI transparency notice'));
      expect(label, contains('test-provider-one'));
      expect(label, contains('test-model-alpha'));
      expect(label, contains('inspector of record'));
      handle.dispose();
    });
  });

  group('it is NOT dismissible — the property that makes it a disclosure', () {
    testWidgets('there is no close or dismiss control of any kind', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        _host(const AiDisclosure(provenance: _provenance)),
      );

      expect(find.byType(IconButton), findsNothing);
      expect(find.byType(CloseButton), findsNothing);
      expect(find.byType(TextButton), findsNothing);
      expect(find.byType(Dismissible), findsNothing);
      expect(find.byIcon(Icons.close), findsNothing);
      expect(find.byIcon(Icons.close_rounded), findsNothing);
      expect(find.byIcon(Icons.clear), findsNothing);
    });

    testWidgets('nothing in it responds to a tap', (WidgetTester tester) async {
      await tester.pumpWidget(
        _host(const AiDisclosure(provenance: _provenance)),
      );

      expect(find.byType(InkWell), findsNothing);
      expect(find.byType(GestureDetector), findsNothing);
    });

    testWidgets('tapping it repeatedly leaves it on screen', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        _host(const AiDisclosure(provenance: _provenance)),
      );

      for (int i = 0; i < 3; i++) {
        await tester.tap(find.byType(AiDisclosure));
        await tester.pumpAndSettle();
      }

      expect(find.textContaining('AI-assisted result'), findsOneWidget);
    });

    testWidgets('a horizontal swipe does not dismiss it', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        _host(const AiDisclosure(provenance: _provenance)),
      );

      await tester.drag(find.byType(AiDisclosure), const Offset(400, 0));
      await tester.pumpAndSettle();

      expect(find.textContaining('AI-assisted result'), findsOneWidget);
    });

    testWidgets('it is stateless, so it cannot hold a dismissed flag', (
      WidgetTester tester,
    ) async {
      // A `_dismissed` bool is the usual way this obligation quietly disappears. A
      // StatelessWidget has nowhere to keep one.
      expect(
        const AiDisclosure(provenance: _provenance),
        isA<StatelessWidget>(),
      );
    });

    testWidgets('it survives a rebuild with the same provenance', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        _host(const AiDisclosure(provenance: _provenance)),
      );
      await tester.pumpWidget(
        _host(const AiDisclosure(provenance: _provenance)),
      );
      await tester.pumpAndSettle();

      expect(find.textContaining('AI-assisted result'), findsOneWidget);
    });
  });

  group('D7 ordering, part 1: it lays out above what follows it', () {
    testWidgets('it sits above a following sibling in normal flow', (
      WidgetTester tester,
    ) async {
      // This is what fails if the disclosure is ever reimplemented as an Overlay, a
      // Positioned, or a bottom sheet — all of which would escape document flow and land
      // below or on top of the checklist regardless of source order.
      await tester.pumpWidget(
        _host(
          const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              AiDisclosure(provenance: _provenance),
              SizedBox(height: 16),
              Text('Checklist', key: Key('checklist-heading')),
            ],
          ),
        ),
      );

      final double disclosureBottom = tester
          .getBottomLeft(find.byType(AiDisclosure))
          .dy;
      final double checklistTop = tester
          .getTopLeft(find.byKey(const Key('checklist-heading')))
          .dy;

      expect(disclosureBottom, lessThanOrEqualTo(checklistTop));
    });

    testWidgets('it renders within its parent width without overflowing', (
      WidgetTester tester,
    ) async {
      // A long provider/model pair must wrap, not throw a layout overflow that would take the
      // capture screen down.
      await tester.pumpWidget(
        _host(
          const AiDisclosure(
            provenance: AiProvenance(
              provider: 'test-provider-with-a-deliberately-very-long-name',
              model:
                  'test-model-gamma-with-an-equally-long-identifier-attached',
              disclosedAt: '2026-09-11T10:00:00.000Z',
            ),
          ),
          width: 320,
        ),
      );

      expect(tester.takeException(), isNull);
      expect(tester.getSize(find.byType(AiDisclosure)).width, 320);
    });

    testWidgets('it still renders at a narrow phone width', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        _host(const AiDisclosure(provenance: _provenance), width: 280),
      );

      expect(tester.takeException(), isNull);
      expect(find.textContaining('AI-assisted result'), findsOneWidget);
    });
  });

  group('D7 ordering, part 2: the caller puts it before the checklist', () {
    // See the file header for why this half is a source assertion rather than a pump.
    late String source;
    late int disclosureAt;

    setUpAll(() {
      final File file = File('lib/src/screens/inspect_screen.dart');
      expect(
        file.existsSync(),
        isTrue,
        reason: 'inspect_screen.dart is the only caller',
      );
      source = file.readAsStringSync();
      disclosureAt = source.indexOf('AiDisclosure(provenance:');
    });

    test('the capture screen renders the disclosure at all', () {
      expect(
        disclosureAt,
        greaterThan(-1),
        reason: 'no AiDisclosure in the capture screen means no Art. 50 disclosure at all',
      );
    });

    test('it appears before the Checklist heading', () {
      final int checklistAt = source.indexOf("'Checklist'");
      expect(
        checklistAt,
        greaterThan(-1),
        reason: "the 'Checklist' heading was not found",
      );

      expect(
        disclosureAt,
        lessThan(checklistAt),
        reason:
            'a disclosure below the checklist is reachable only by scrolling past the '
            'answers it influenced, and has informed nobody',
      );
    });

    test('it appears before the AI-suggested issues it explains', () {
      final int issuesAt = source.indexOf('_AiIssues(');
      expect(issuesAt, greaterThan(-1), reason: '_AiIssues was not found');

      expect(disclosureAt, lessThan(issuesAt));
    });

    test('it is passed the provenance, not a hardcoded true', () {
      expect(source, contains('AiDisclosure(provenance: _provenance)'));
    });

    test('no caller wraps it in something dismissible', () {
      // A non-dismissible widget inside a dismissible container is dismissible.
      final String window = source.substring(
        (disclosureAt - 400).clamp(0, source.length),
        (disclosureAt + 200).clamp(0, source.length),
      );

      expect(window, isNot(contains('Dismissible')));
      expect(window, isNot(contains('showDialog')));
      expect(window, isNot(contains('showModalBottomSheet')));
    });
  });
}
