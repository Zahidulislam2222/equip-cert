/// Which plans may sign is decided by the database (`enforce_plan_limits`) and described for the
/// web client by `canAccess(plan, 'signatures')` in src/lib/plans.ts. The mobile screen hides the
/// signature pad on other plans, so its list must match — a mismatch either shows a pad the
/// database will reject or files an unsigned record a paying customer wanted signed.
library;

import 'dart:io';

import 'package:equipcert_mobile/src/data/models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('signature plans equal canAccess(..., "signatures") in plans.ts', () {
    final String source = File('../src/lib/plans.ts').readAsStringSync();
    final RegExpMatch? match = RegExp(r'signatures:\s*\[([^\]]*)\]')
        .firstMatch(source);
    expect(match, isNotNull, reason: 'plans.ts no longer declares signatures');
    final Set<String> webPlans = RegExp(r"'([a-z]+)'")
        .allMatches(match!.group(1)!)
        .map((RegExpMatch m) => m.group(1)!)
        .toSet();
    expect(signaturePlans, webPlans);
  });

  test('free never signs; pro and enterprise do', () {
    expect(planAllowsSignatures('free'), isFalse);
    expect(planAllowsSignatures('pro'), isTrue);
    expect(planAllowsSignatures('enterprise'), isTrue);
  });
}
