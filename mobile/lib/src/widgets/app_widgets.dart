/// The shared UI vocabulary: one definition per control, read from the theme.
///
/// Every widget here takes its colours from `Theme.of(context).extension<AppColors>()` and
/// never from a literal. That is the same one-owner-per-value rule the rest of the project
/// runs on (Global Rule 12) applied to presentation: a hex code typed into a screen is a
/// design token with no owner, and it is exactly how the web client ended up with three
/// disagreeing sources for its own palette.
///
/// Sizing is not cosmetic either. Every interactive element here is at least
/// [AppMetrics.minTapTarget] tall. WCAG 2.1 AA sets the floor at 44x44; this app is operated
/// in gloves, in a plant room, one-handed, so the floor is 48. DEF-013 was an undersized-target
/// failure that shipped on the web client.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme/app_theme.dart';

/// Shorthand for the palette. Non-null: [AppTheme] registers the extension on both themes and
/// `theme_tokens_test.dart` asserts it, so a null here is a wiring bug worth crashing on
/// rather than a case to paper over with Material defaults.
AppColors colorsOf(BuildContext context) =>
    Theme.of(context).extension<AppColors>()!;

/// The brand mark.
///
/// `AppMetrics.brandGradient` is restricted by the stylesheet to exactly this use — "Brand
/// mark only. Not a text treatment, not a button, not a card." Buttons use flat
/// [AppColors.primary].
class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.size = 44, this.showWordmark = true});

  final double size;
  final bool showWordmark;

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Container(
          height: size,
          width: size,
          decoration: BoxDecoration(
            gradient: AppMetrics.brandGradient,
            borderRadius: BorderRadius.circular(size * 0.28),
          ),
          child: Icon(
            Icons.local_fire_department_rounded,
            size: size * 0.6,
            color: c.primaryForeground,
          ),
        ),
        if (showWordmark) ...<Widget>[
          const SizedBox(width: 12),
          Text(
            'EquipCert',
            style: Theme.of(context).textTheme.headlineSmall
                ?.copyWith(letterSpacing: -0.5),
          ),
        ],
      ],
    );
  }
}

/// A labelled text field.
///
/// The label is a real [Text] above the field rather than a floating placeholder. A
/// placeholder that disappears on focus fails WCAG 3.3.2 — it removes the only description of
/// the field at the moment the person is filling it in — and it is unreadable in daylight on
/// a phone, which is where this app is used.
class AppTextField extends StatelessWidget {
  const AppTextField({
    super.key,
    required this.label,
    required this.controller,
    this.hint,
    this.helper,
    this.errorText,
    this.obscureText = false,
    this.keyboardType,
    this.textInputAction,
    this.autofillHints,
    this.onSubmitted,
    this.onChanged,
    this.enabled = true,
    this.maxLines = 1,
    this.trailing,
    this.autocorrect = true,
    this.textCapitalization = TextCapitalization.none,
  });

  final String label;
  final TextEditingController controller;
  final String? hint;
  final String? helper;
  final String? errorText;
  final bool obscureText;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final Iterable<String>? autofillHints;
  final ValueChanged<String>? onSubmitted;

  /// Fires on every keystroke. Used for checks that must not wait for submit — the breached-
  /// password lookup on the signup form is the reason it exists.
  final ValueChanged<String>? onChanged;

  final bool enabled;
  final int maxLines;
  final Widget? trailing;
  final bool autocorrect;
  final TextCapitalization textCapitalization;

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);
    final TextTheme text = Theme.of(context).textTheme;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(label, style: text.labelLarge),
        const SizedBox(height: 6),
        TextField(
          controller: controller,
          obscureText: obscureText,
          enabled: enabled,
          keyboardType: keyboardType,
          textInputAction: textInputAction,
          autofillHints: autofillHints,
          onSubmitted: onSubmitted,
          onChanged: onChanged,
          maxLines: obscureText ? 1 : maxLines,
          autocorrect: autocorrect,
          textCapitalization: textCapitalization,
          style: text.bodyLarge,
          cursorColor: c.primary,
          decoration: InputDecoration(
            hintText: hint,
            errorText: errorText,
            suffixIcon: trailing,
            filled: true,
            fillColor: c.elevated,
            hintStyle: text.bodyLarge?.copyWith(color: c.mutedForeground),
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 14,
              vertical: 14,
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(AppMetrics.radiusMd),
              borderSide: BorderSide(color: c.border),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(AppMetrics.radiusMd),
              // 2px, not a colour change alone. A focus ring that only changes hue is
              // invisible to a large share of colour-blind users (WCAG 1.4.11 / 2.4.7).
              borderSide: BorderSide(color: c.primary, width: 2),
            ),
            errorBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(AppMetrics.radiusMd),
              borderSide: BorderSide(color: c.destructive),
            ),
            focusedErrorBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(AppMetrics.radiusMd),
              borderSide: BorderSide(color: c.destructive, width: 2),
            ),
            disabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(AppMetrics.radiusMd),
              borderSide: BorderSide(color: c.border.withValues(alpha: 0.5)),
            ),
          ),
        ),
        if (helper != null) ...<Widget>[
          const SizedBox(height: 6),
          Text(helper!, style: text.bodySmall),
        ],
      ],
    );
  }
}

/// Visual weight of an [AppButton].
enum AppButtonVariant { primary, secondary, ghost, destructive }

/// The one button.
///
/// [busy] shows a spinner AND disables the button, because those two states are the same state
/// — a submit button that still accepts taps while a request is in flight files the inspection
/// twice, and the second one is a duplicate compliance record that someone has to explain.
class AppButton extends StatelessWidget {
  const AppButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.variant = AppButtonVariant.primary,
    this.busy = false,
    this.icon,
    this.expand = true,
  });

  final String label;
  final VoidCallback? onPressed;
  final AppButtonVariant variant;
  final bool busy;
  final IconData? icon;
  final bool expand;

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);
    final bool disabled = busy || onPressed == null;

    final (
      Color background,
      Color foreground,
      Color? border,
    ) = switch (variant) {
      AppButtonVariant.primary => (c.primary, c.primaryForeground, null),
      AppButtonVariant.secondary => (c.elevated, c.foreground, c.border),
      AppButtonVariant.ghost => (Colors.transparent, c.foreground, null),
      AppButtonVariant.destructive => (
        c.destructive,
        c.destructiveForeground,
        null,
      ),
    };

    final Widget child = busy
        ? SizedBox(
            height: 20,
            width: 20,
            child: CircularProgressIndicator(
              strokeWidth: 2.4,
              color: foreground,
            ),
          )
        : Row(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              if (icon != null) ...<Widget>[
                Icon(icon, size: 20),
                const SizedBox(width: 8),
              ],
              Flexible(
                child: Text(
                  label,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelLarge
                      ?.copyWith(color: foreground, fontSize: 15),
                ),
              ),
            ],
          );

    return Semantics(
      button: true,
      enabled: !disabled,
      label: label,
      child: SizedBox(
        width: expand ? double.infinity : null,
        height: AppMetrics.minTapTarget,
        child: Material(
          color: disabled ? background.withValues(alpha: 0.5) : background,
          borderRadius: BorderRadius.circular(AppMetrics.radiusMd),
          child: InkWell(
            onTap: disabled ? null : onPressed,
            borderRadius: BorderRadius.circular(AppMetrics.radiusMd),
            child: Container(
              alignment: Alignment.center,
              padding: const EdgeInsets.symmetric(horizontal: 18),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(AppMetrics.radiusMd),
                border: border == null ? null : Border.all(color: border),
              ),
              child: DefaultTextStyle.merge(
                style: TextStyle(color: foreground),
                child: IconTheme.merge(
                  data: IconThemeData(color: foreground),
                  child: child,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Tone of a [MessageBanner].
enum BannerTone { info, success, warning, error }

/// An inline message.
///
/// Never a [SnackBar] for anything that matters. A snackbar auto-dismisses, so a technician
/// who looked away misses it entirely — and the messages this app shows are things like "the
/// inspection was queued offline" and "that upload failed", which have to stay on screen until
/// they are read.
///
/// Every tone pairs its colour with an ICON. Colour alone conveying meaning is WCAG 1.4.1, and
/// the palette has a known contrast gap in exactly these colours (DEF-046), so the icon is
/// carrying real load here rather than decorating.
class MessageBanner extends StatelessWidget {
  const MessageBanner({
    super.key,
    required this.message,
    this.tone = BannerTone.info,
    this.onDismiss,
    this.action,
  });

  final String message;
  final BannerTone tone;
  final VoidCallback? onDismiss;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);

    final (Color accent, IconData icon) = switch (tone) {
      BannerTone.info => (c.mutedForeground, Icons.info_outline_rounded),
      BannerTone.success => (c.success, Icons.check_circle_outline_rounded),
      BannerTone.warning => (c.warning, Icons.warning_amber_rounded),
      BannerTone.error => (c.destructive, Icons.error_outline_rounded),
    };

    return Semantics(
      liveRegion: true,
      container: true,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: accent.withValues(alpha: 0.10),
          borderRadius: BorderRadius.circular(AppMetrics.radiusMd),
          border: Border.all(color: accent.withValues(alpha: 0.45)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(icon, size: 20, color: accent),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    message,
                    style: Theme.of(context).textTheme.bodyMedium
                        ?.copyWith(color: c.foreground),
                  ),
                  if (action != null) ...<Widget>[
                    const SizedBox(height: 10),
                    action!,
                  ],
                ],
              ),
            ),
            if (onDismiss != null)
              IconButton(
                onPressed: onDismiss,
                icon: const Icon(Icons.close_rounded, size: 18),
                color: c.mutedForeground,
                tooltip: 'Dismiss',
                constraints: const BoxConstraints(
                  minWidth: AppMetrics.minTapTarget,
                  minHeight: AppMetrics.minTapTarget,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// A surface with the card token and the card shadow.
class AppCard extends StatelessWidget {
  const AppCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.onTap,
    this.borderColor,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;
  final Color? borderColor;

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);

    final Widget content = Container(
      padding: padding,
      decoration: BoxDecoration(
        color: c.card,
        borderRadius: AppMetrics.borderRadius,
        border: Border.all(color: borderColor ?? c.border),
        boxShadow: AppMetrics.cardShadow,
      ),
      child: child,
    );

    if (onTap == null) return content;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: AppMetrics.borderRadius,
        child: content,
      ),
    );
  }
}

/// A small status pill.
class StatusPill extends StatelessWidget {
  const StatusPill({
    super.key,
    required this.label,
    required this.color,
    this.icon,
  });

  final String label;
  final Color color;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (icon != null) ...<Widget>[
            // Paired with the label, never colour alone (WCAG 1.4.1).
            Icon(icon, size: 13, color: color),
            const SizedBox(width: 5),
          ],
          Text(
            label,
            style: Theme.of(context).textTheme.labelSmall
                ?.copyWith(color: color, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

/// The empty state for a list that legitimately has nothing in it.
///
/// Distinct from an error. "No inspections yet" and "could not load inspections" mean opposite
/// things to a technician deciding whether to redo work, and a spinner that resolves to a
/// blank screen tells them neither.
class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
    this.action,
  });

  final IconData icon;
  final String title;
  final String message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(icon, size: 44, color: c.mutedForeground),
            const SizedBox(height: 16),
            Text(title, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            Text(
              message,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium
                  ?.copyWith(color: c.mutedForeground),
            ),
            if (action != null) ...<Widget>[
              const SizedBox(height: 20),
              action!,
            ],
          ],
        ),
      ),
    );
  }
}

/// Full-screen loading, used only where there is genuinely nothing to show yet.
class LoadingState extends StatelessWidget {
  const LoadingState({super.key, this.message});

  final String? message;

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);

    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          CircularProgressIndicator(color: c.primary),
          if (message != null) ...<Widget>[
            const SizedBox(height: 16),
            Text(message!, style: Theme.of(context).textTheme.bodyMedium),
          ],
        ],
      ),
    );
  }
}

/// Failure state with a retry.
///
/// [error] is deliberately NOT rendered raw. A PostgREST error carries table names, column
/// names and policy names; showing it to a technician is both useless to them and a small
/// disclosure of the schema. The detail belongs in the log, the meaning belongs on screen.
class ErrorState extends StatelessWidget {
  const ErrorState({super.key, required this.message, this.onRetry});

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            MessageBanner(message: message, tone: BannerTone.error),
            if (onRetry != null) ...<Widget>[
              const SizedBox(height: 16),
              AppButton(
                label: 'Try again',
                onPressed: onRetry,
                variant: AppButtonVariant.secondary,
                icon: Icons.refresh_rounded,
                expand: false,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Keep the status-bar icons legible against the app's own background.
///
/// Without this the OS picks based on its own theme, so a dark app under a light system theme
/// gets dark status icons on a near-black bar and the clock disappears.
SystemUiOverlayStyle overlayStyleFor(Brightness brightness) =>
    brightness == Brightness.dark
    ? SystemUiOverlayStyle.light
    : SystemUiOverlayStyle.dark;
