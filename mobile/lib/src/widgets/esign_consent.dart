/// Explicit consent to sign electronically, given before the signature pad accepts a stroke.
///
/// The web client has gated its pad on "I agree to sign electronically" from the start; this
/// client showed only a notice and then the pad, while the public docs claimed explicit consent
/// for the product as a whole (DEF-067). ESIGN (15 U.S.C. §7001) requires that a person agree to
/// do business electronically — a notice they scrolled past is not agreement.
///
/// The statement is the one `src/components/shared/SignaturePad.tsx` shows, with "checking" read
/// as "ticking" for a touch control and without the web copy's capitals. Same legal content —
/// change one, change the other.
library;

import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import 'app_widgets.dart';

class ESignConsent extends StatelessWidget {
  const ESignConsent({
    super.key,
    required this.consented,
    required this.onChanged,
    this.enabled = true,
  });

  final bool consented;
  final ValueChanged<bool> onChanged;

  /// False while the inspection is being filed: the signature already captured was given under
  /// this consent, so it must not be withdrawable half-way through the upload.
  final bool enabled;

  static const String statement =
      'By ticking this box, you affirmatively consent to sign this equipment inspection record '
      'electronically under the ESIGN Act (15 U.S.C. §7001). Your electronic signature has the '
      'same legal effect as a handwritten signature. Signed records cannot be modified after '
      'submission. You may withdraw consent by contacting your administrator.';

  static const String label = 'I agree to sign electronically';

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);
    final TextTheme text = Theme.of(context).textTheme;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: c.card,
        borderRadius: BorderRadius.circular(AppMetrics.radiusMd),
        border: Border.all(color: consented ? c.border : c.primary),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            'Electronic signature consent',
            style: text.titleSmall?.copyWith(color: c.foreground),
          ),
          const SizedBox(height: 6),
          Text(
            statement,
            style: text.bodySmall?.copyWith(
              color: c.mutedForeground,
              height: 1.4,
            ),
          ),
          const SizedBox(height: 8),
          // The whole row is the target (48dp), not just the 18dp box — gloved hands on site.
          MergeSemantics(
            child: InkWell(
              borderRadius: BorderRadius.circular(AppMetrics.radiusMd),
              onTap: enabled ? () => onChanged(!consented) : null,
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 48),
                child: Row(
                  children: <Widget>[
                    Checkbox(
                      value: consented,
                      onChanged: enabled
                          ? (bool? v) => onChanged(v ?? false)
                          : null,
                    ),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        label,
                        style: text.bodyMedium?.copyWith(
                          color: c.foreground,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
