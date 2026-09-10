/// EU AI Act Article 50(1) disclosure, as a widget.
///
/// ---------------------------------------------------------------------------------------
/// WHAT THE LAW ACTUALLY REQUIRES
///
/// Art. 50(1): a person interacting with an AI system must be informed that they are, unless
/// it is obvious to a reasonably well-informed person. Binding since 2 August 2026, with no
/// grace period.
///
/// Three properties follow from "informed", and all three are structural rather than cosmetic:
///
///   1. **It is shown BEFORE the person acts on the output.** A disclosure under the
///      checklist, reachable only by scrolling past the answers it influenced, has not
///      informed anyone. This widget is placed above the checklist by every caller.
///   2. **It is not dismissible.** There is no close button, and no `_dismissed` flag. A
///      banner the user can dismiss is a banner that is absent for every subsequent
///      inspection, which is precisely the interaction the article is about.
///   3. **It names the actual provider and model**, taken from server-stamped provenance.
///      "This app uses AI" is a marketing sentence; "Google gemini-2.5-flash produced this
///      suggestion" is a disclosure someone can act on.
///
/// ---------------------------------------------------------------------------------------
/// WHY IT ALSO SAYS WHO DECIDES
///
/// The second sentence — that the technician's answers are what get recorded — is not legal
/// boilerplate. It is the difference between a tool that assists a qualified inspector and one
/// that makes the determination, and that distinction is what keeps EquipCert out of Annex III
/// high-risk classification (docs/compliance/ai-act-classification.md). A UI that presented
/// the AI result as the finding would make the classification argument false, whatever the
/// document says.
library;

import 'package:flutter/material.dart';

import '../compliance/ai_provenance.dart';
import '../theme/app_theme.dart';
import 'app_widgets.dart';

class AiDisclosure extends StatelessWidget {
  const AiDisclosure({super.key, required this.provenance});

  /// Null means no AI ran on this inspection — the manual path, or an analysis that failed.
  /// The widget then renders NOTHING, because there is nothing to disclose and a disclosure
  /// shown where no AI was involved trains people to ignore the real one.
  final AiProvenance? provenance;

  @override
  Widget build(BuildContext context) {
    final AiProvenance? p = provenance;
    if (p == null) return const SizedBox.shrink();

    final AppColors c = colorsOf(context);
    final TextTheme text = Theme.of(context).textTheme;

    return Semantics(
      // Announced as one unit. Read as separate labels, a screen-reader user gets
      // "AI", "Google", "gemini-2.5-flash" with no statement connecting them.
      container: true,
      label: 'AI transparency notice',
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: c.elevated,
          borderRadius: BorderRadius.circular(AppMetrics.radiusMd),
          // The primary colour, not `warning`. This is information, not a problem — styling a
          // legally required notice as an alert makes it look like something went wrong.
          border: Border.all(color: c.primary.withValues(alpha: 0.45)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Icon(Icons.auto_awesome_rounded, size: 18, color: c.primary),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'AI-assisted result',
                    style: text.titleSmall?.copyWith(color: c.foreground),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              'The equipment details and suggested issues below were produced by an AI '
              'system (${p.provider} · ${p.model}). Review every item yourself — your '
              'answers are what get recorded, and you are the inspector of record.',
              style: text.bodySmall?.copyWith(
                color: c.mutedForeground,
                height: 1.45,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The same obligation, for a record being READ rather than created.
///
/// An inspection stored with `ai_assisted = true` has to keep disclosing that when it is
/// reviewed months later by a manager or an auditor who never saw the capture screen. The
/// columns exist precisely so the disclosure survives the session that produced it.
class AiProvenanceNote extends StatelessWidget {
  const AiProvenanceNote({
    super.key,
    required this.aiAssisted,
    this.provider,
    this.model,
  });

  final bool aiAssisted;
  final String? provider;
  final String? model;

  @override
  Widget build(BuildContext context) {
    if (!aiAssisted) return const SizedBox.shrink();

    final AppColors c = colorsOf(context);

    // `ai_provenance_is_complete` guarantees provider and model are both present whenever
    // `ai_assisted` is true, so this fallback should be unreachable. It is here because the
    // alternative on an unexpected row is a `!` that throws while rendering a compliance
    // record — the one screen that must not fail to display.
    final String attribution = (provider != null && model != null)
        ? '$provider · $model'
        : 'provider not recorded';

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Icon(Icons.auto_awesome_rounded, size: 16, color: c.primary),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            'AI-assisted inspection ($attribution). The checklist answers and the signature '
            'are the inspector\'s own.',
            style: Theme.of(context).textTheme.bodySmall
                ?.copyWith(color: c.mutedForeground, height: 1.4),
          ),
        ),
      ],
    );
  }
}
