/// The e-signature consent wording is a legal statement, and the version recorded with consent
/// (`profiles.esign_consent_version`) is the evidence of which wording a person agreed to. Both
/// clients must therefore show the SAME words under the SAME version.
///
/// `src/content/esign-consent.json` is the owner; [ESignConsent] carries a copy because a released
/// app cannot read the repository. This test reads the owner file and compares.
library;

import 'dart:convert';
import 'dart:io';

import 'package:equipcert_mobile/src/widgets/esign_consent.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final Map<String, dynamic> owner = jsonDecode(
    File('../src/content/esign-consent.json').readAsStringSync(),
  ) as Map<String, dynamic>;

  test('the statement is word-for-word the web wording', () {
    expect(ESignConsent.statement, owner['statement']);
  });

  test('the checkbox label matches', () {
    expect(ESignConsent.label, owner['label']);
  });

  test(
    'the recorded version matches, so the evidence names the right wording',
    () {
      expect(ESignConsent.version, owner['version']);
    },
  );
}
