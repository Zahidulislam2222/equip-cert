// EU AI Act Article 50 — transparency for AI-generated content. Mobile half.
//
// The web implementation is `src/lib/compliance/ai-act.ts` and this is a faithful port. Both
// clients write to the same four columns on `inspections`, and the database enforces the
// same CHECK constraint against both, so a divergence here surfaces as a constraint violation
// rather than as a quietly wrong compliance record.
//
// TWO OBLIGATIONS, TWO DEADLINES — easy to conflate, so stated plainly:
//
//   Art. 50(1)  disclosure to the human interacting with the system.
//               Binding since 2 August 2026. NO grace period.
//   Art. 50(2)  machine-readable marking of generated output.
//               Pre-existing systems have until 2 December 2026 (AI Omnibus, May 2026).
//
// This module owns the FIRST. The second is still open on both clients — see DEFECT-LOG.
//
// CLASSIFICATION: EquipCert is NOT high-risk under Annex III. Photo analysis that suggests a
// checklist to a qualified human inspector is neither a safety component of critical
// infrastructure nor an employment decision. Reasoning is in
// docs/compliance/ai-act-classification.md. Article 50 applies regardless of risk tier.

import 'package:meta/meta.dart';

/// Provenance for one AI-assisted result.
///
/// The provider and model are supplied by the SERVER. A client cannot know which model ran —
/// it is chosen from server-only configuration that never reaches a device — so a
/// client-asserted provenance value would be traceability theatre. The mobile client is even
/// less entitled to assert it than the web one: an APK can be decompiled and its constants
/// edited, so anything this app claims about itself is attacker-controlled.
@immutable
class AiProvenance {
  const AiProvenance({
    required this.provider,
    required this.model,
    required this.disclosedAt,
  });

  final String provider;
  final String model;

  /// Server-generated ISO-8601 timestamp of the moment the disclosure obligation triggered.
  /// Kept as the raw string it arrived as — reformatting a compliance timestamp on a device
  /// whose clock and locale are unverified would degrade the record.
  final String disclosedAt;

  /// Validate an object that crossed the network.
  ///
  /// Returns null rather than throwing, and null means "record no AI claim". That is the
  /// safe direction: under-claiming AI involvement on a record that had none is a formatting
  /// difference, while over-claiming it — or claiming it with a provider we cannot name —
  /// puts an unverifiable statement onto a safety document.
  ///
  /// This is validation, not a cast. `json['provider'] as String` would throw on a malformed
  /// payload and take the inspection down with it.
  static AiProvenance? tryParse(Object? value) {
    if (value is! Map) return null;

    // The server sends `aiAssisted: true`. Anything else — false, absent, the STRING
    // "false", 1 — is not an assertion of AI involvement. The string case is the one that
    // matters: `"false"` is truthy in a loose check and would flip this to a positive claim.
    if (value['aiAssisted'] != true) return null;

    final Object? provider = value['provider'];
    final Object? model = value['model'];
    final Object? disclosedAt = value['disclosedAt'];

    if (provider is! String || provider.isEmpty) return null;
    if (model is! String || model.isEmpty) return null;
    if (disclosedAt is! String || disclosedAt.isEmpty) return null;

    return AiProvenance(
      provider: provider,
      model: model,
      disclosedAt: disclosedAt,
    );
  }

  /// Map onto the `inspections` AI provenance columns.
  ///
  /// The database enforces `ai_provenance_is_complete`: either every AI column is NULL and
  /// `ai_assisted` is false, or provider and model are both present. So this returns all four
  /// together or all four empty — never a partial set that the insert would reject.
  ///
  /// A null receiver is the honest "no AI was involved" case. It is a real state on the
  /// manual inspection path, not a missing value to be papered over.
  static Map<String, Object?> toColumns(AiProvenance? provenance) {
    if (provenance == null) {
      return const <String, Object?>{
        'ai_assisted': false,
        'ai_provider': null,
        'ai_model': null,
        'ai_disclosed_at': null,
      };
    }
    return <String, Object?>{
      'ai_assisted': true,
      'ai_provider': provenance.provider,
      'ai_model': provenance.model,
      'ai_disclosed_at': provenance.disclosedAt,
    };
  }

  @override
  bool operator ==(Object other) =>
      other is AiProvenance &&
      other.provider == provider &&
      other.model == model &&
      other.disclosedAt == disclosedAt;

  @override
  int get hashCode => Object.hash(provider, model, disclosedAt);

  @override
  String toString() => 'AiProvenance($provider/$model @ $disclosedAt)';
}
