/// DEF-067 — the signature pad accepts no stroke until e-signature consent is given.
///
/// Same split as `ai_disclosure_widget_test.dart`, for the same reason: `InspectScreen` resolves
/// Supabase, go_router and platform channels that do not exist in a `flutter test` VM, so the
/// behaviour is proven in a real pump of the two widgets wired the way the screen wires them,
/// and the screen's wiring is proven by reading its source. Neither is pretended to be the other.
library;

import 'dart:io';

import 'package:equipcert_mobile/src/theme/app_theme.dart';
import 'package:equipcert_mobile/src/widgets/esign_consent.dart';
import 'package:equipcert_mobile/src/widgets/signature_pad.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// The pad and the consent control, wired exactly as `inspect_screen.dart` wires them.
class _Harness extends StatefulWidget {
  const _Harness({required this.controller});

  final SignaturePadController controller;

  @override
  State<_Harness> createState() => _HarnessState();
}

class _HarnessState extends State<_Harness> {
  bool _consented = false;

  @override
  Widget build(BuildContext context) => Column(
    children: <Widget>[
      ESignConsent(
        consented: _consented,
        onChanged: (bool value) {
          setState(() => _consented = value);
          if (!value) widget.controller.clear();
        },
      ),
      SignaturePad(controller: widget.controller, enabled: _consented),
    ],
  );
}

Future<SignaturePadController> _pump(WidgetTester tester) async {
  final SignaturePadController controller = SignaturePadController();
  addTearDown(controller.dispose);
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.dark,
      home: Scaffold(
        body: SingleChildScrollView(
          child: SizedBox(width: 400, child: _Harness(controller: controller)),
        ),
      ),
    ),
  );
  return controller;
}

Future<void> _drawStroke(WidgetTester tester) async {
  // The pad's own gesture surface — other CustomPaints (the checkbox) sit in the same tree.
  final Finder surface = find
      .descendant(
        of: find.byType(SignaturePad),
        matching: find.byType(GestureDetector),
      )
      .first;
  await tester.ensureVisible(surface);
  await tester.pump();
  await tester.dragFrom(tester.getCenter(surface), const Offset(80, 20));
  await tester.pump();
}

void main() {
  testWidgets('starts unticked and the pad says why it will not draw', (
    WidgetTester tester,
  ) async {
    await _pump(tester);
    final Checkbox box = tester.widget<Checkbox>(find.byType(Checkbox));
    expect(box.value, isFalse);
    expect(find.text(ESignConsent.label), findsOneWidget);
    expect(find.text('Agree to sign electronically first'), findsOneWidget);
    expect(find.text('Sign here'), findsNothing);
  });

  testWidgets('a stroke before consent is ignored', (
    WidgetTester tester,
  ) async {
    final SignaturePadController controller = await _pump(tester);
    await _drawStroke(tester);
    expect(controller.isEmpty, isTrue);
  });

  testWidgets('after ticking, the same stroke registers', (
    WidgetTester tester,
  ) async {
    final SignaturePadController controller = await _pump(tester);
    await tester.tap(find.text(ESignConsent.label));
    await tester.pump();
    expect(find.text('Sign here'), findsOneWidget);
    await _drawStroke(tester);
    expect(controller.isEmpty, isFalse);
  });

  testWidgets('withdrawing consent clears the signature and locks the pad', (
    WidgetTester tester,
  ) async {
    final SignaturePadController controller = await _pump(tester);
    await tester.tap(find.byType(Checkbox));
    await tester.pump();
    await _drawStroke(tester);
    expect(controller.isEmpty, isFalse);

    await tester.tap(find.byType(Checkbox));
    await tester.pump();
    expect(controller.isEmpty, isTrue);
    await _drawStroke(tester);
    expect(controller.isEmpty, isTrue);
  });

  testWidgets('while filing, consent cannot be withdrawn', (
    WidgetTester tester,
  ) async {
    final List<bool> changes = <bool>[];
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.dark,
        home: Scaffold(
          body: ESignConsent(
            consented: true,
            enabled: false,
            onChanged: changes.add,
          ),
        ),
      ),
    );
    await tester.tap(find.text(ESignConsent.label));
    await tester.tap(find.byType(Checkbox));
    await tester.pump();
    expect(changes, isEmpty);
  });

  test('inspect_screen wires consent before the pad and into the blocker', () {
    final String source = File('lib/src/screens/inspect_screen.dart')
        .readAsStringSync();

    final int consent = source.indexOf('ESignConsent(');
    final int pad = source.indexOf('SignaturePad(controller: _signature');
    expect(consent, greaterThan(0), reason: 'consent control missing');
    expect(pad, greaterThan(consent), reason: 'pad must follow consent');
    expect(
      source,
      contains(
        'SignaturePad(controller: _signature, enabled: _esignConsented)',
      ),
    );
    expect(source, contains('if (!_esignConsented) return'));
    expect(source, contains('enabled: !_submitting'));
    expect(source, contains('if (!value) _signature.clear();'));
  });
}
