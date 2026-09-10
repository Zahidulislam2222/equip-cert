import 'package:flutter/material.dart';

/// The EquipCert design system, ported from `src/app/globals.css`.
///
/// ---------------------------------------------------------------------------------------
/// WHERE THIS COMES FROM, AND WHAT NOT TO TRUST
///
/// `src/app/globals.css` is the SOLE OWNER of these values. This file is a translation of it
/// into Flutter's type system, and it is a translation that has to be kept honest by hand —
/// there is no build step joining the two. `mobile/test/theme_tokens_test.dart` parses the CSS
/// and asserts every token below still matches it, so drift fails a gate instead of shipping.
///
/// Two other sources in this repository describe a DIFFERENT design and both are stale:
///
///   * `AGENTS.md` still documents Deep Industrial Blue `210 100% 45%`, Safety Orange, and
///     Plus Jakarta Sans. That is the system commit 69e13bf replaced.
///   * `my-project-view/Frontend/*.png` are screenshots of the app before that commit —
///     light theme, blue buttons.
///
/// The owner confirmed the current build (dark, Safety Yellow) as the approved design on
/// 2026-09-10. Do not reintroduce blue.
///
/// ---------------------------------------------------------------------------------------
/// DARK IS THE DEFAULT, NOT THE ALTERNATE
///
/// In the CSS, `:root` IS the dark theme and `.light` is the opt-in override. That is the
/// reverse of the usual arrangement and it is deliberate: this is a tool used in plant rooms
/// and basements. [darkTheme] is therefore the primary here too, and [lightTheme] exists for
/// the technician who wants it in daylight.
///
/// ---------------------------------------------------------------------------------------
/// ONE ACCENT. The rule, verbatim from the CSS:
///
///   > ONE ACCENT. Safety Yellow carries every call to action. Green / amber / red are
///   > SEMANTIC ONLY — they mean pass, warning and fail. Never spend them as decoration:
///   > this is an inspection product and those three colours have to keep meaning something.
///
/// So: yellow on every CTA. [AppColors.success] appears only on a passed check,
/// [AppColors.destructive] only on a failed one, [AppColors.warning] only on a warning.
/// A green "sync complete" chip is a violation of this rule — use the foreground colour.
/// ---------------------------------------------------------------------------------------

/// One resolved palette. Two instances exist: [AppColors.dark] and [AppColors.light].
///
/// Exposed on the [ThemeData] as a [ThemeExtension] so widgets read
/// `Theme.of(context).extension<AppColors>()!` and automatically follow the active theme,
/// rather than importing a const and pinning themselves to one of the two.
@immutable
class AppColors extends ThemeExtension<AppColors> {
  const AppColors({
    required this.primary,
    required this.primaryForeground,
    required this.background,
    required this.foreground,
    required this.card,
    required this.elevated,
    required this.muted,
    required this.mutedForeground,
    required this.border,
    required this.success,
    required this.successForeground,
    required this.warning,
    required this.warningForeground,
    required this.destructive,
    required this.destructiveForeground,
  });

  /// Safety Yellow. Every call to action.
  final Color primary;
  final Color primaryForeground;

  final Color background;
  final Color foreground;

  /// Surface for raised content. Warm neutral — "the colour of concrete and shadow.
  /// Deliberately not blue-grey; that reads as generic dark-mode SaaS."
  final Color card;
  final Color elevated;

  final Color muted;
  final Color mutedForeground;
  final Color border;

  /// SEMANTIC ONLY — a checklist item that passed.
  final Color success;
  final Color successForeground;

  /// SEMANTIC ONLY — a warning.
  final Color warning;
  final Color warningForeground;

  /// SEMANTIC ONLY — a checklist item that failed.
  final Color destructive;
  final Color destructiveForeground;

  /// `:root` in globals.css. The default.
  static const AppColors dark = AppColors(
    primary: Color(0xFFFFC61A), // hsl(45 100% 55%)
    primaryForeground: Color(0xFF120F0C), // hsl(30 20% 6%)
    background: Color(0xFF110F0E), // hsl(30 8% 6%)
    foreground: Color(0xFFEDEBE8), // hsl(36 12% 92%)
    card: Color(0xFF191715), // hsl(30 8% 9%)
    elevated: Color(0xFF211F1C), // hsl(30 7% 12%)
    muted: Color(0xFF292624), // hsl(30 6% 15%)
    mutedForeground: Color(0xFF9B958C), // hsl(34 7% 58%)
    border: Color(0xFF2E2C28), // hsl(32 7% 17%)
    success: Color(0xFF2BAB6F), // hsl(152 60% 42%)
    // Near-black, not white. White on this green measured 2.922:1, and this pair is the PASS
    // button in the technician flow. DEF-046.
    successForeground: Color(0xFF1D140C), // hsl(30 40% 8%)
    warning: Color(0xFFF98C10), // hsl(32 95% 52%)
    warningForeground: Color(0xFF1D140C), // hsl(30 40% 8%)
    // 52% -> 62.5% lightness: at 52% this measured 3.409:1 as text on the near-black surface,
    // and it is the colour that marks a FAILED check. Hue and saturation unchanged. DEF-046.
    destructive: Color(0xFFE66259), // hsl(4 74% 62.5%)
    destructiveForeground: Color(0xFF1D140C), // hsl(30 40% 8%)
  );

  /// `.light` in globals.css. The opt-in override.
  static const AppColors light = AppColors(
    primary: Color(0xFFD69600), // hsl(42 100% 42%)
    primaryForeground: Color(0xFF120F0C), // hsl(30 20% 6%)
    background: Color(0xFFF7F5F3), // hsl(36 22% 96%)
    foreground: Color(0xFF1D1A16), // hsl(30 14% 10%)
    card: Color(0xFFFFFFFF), // hsl(0 0% 100%)
    elevated: Color(0xFFFDFDFC), // hsl(36 20% 99%)
    muted: Color(0xFFEBE8E5), // hsl(34 14% 91%)
    mutedForeground: Color(0xFF746C63), // hsl(32 8% 42%)
    border: Color(0xFFE0DCD7), // hsl(34 12% 86%)
    success: Color(0xFF1C764C), // hsl(152 62% 28.5%)  DEF-046
    successForeground: Color(0xFFFFFFFF),
    // 44% -> 31.5%: at 44% this measured 2.669:1, below even the 3:1 non-text floor. The
    // darker amber then needs a WHITE label rather than the near-black one. DEF-046.
    warning: Color(0xFF9A5506), // hsl(32 92% 31.5%)
    warningForeground: Color(0xFFFFFFFF),
    destructive: Color(0xFFC12D22), // hsl(4 70% 44.5%)  DEF-046
    destructiveForeground: Color(0xFFFFFFFF),
  );

  @override
  AppColors copyWith({
    Color? primary,
    Color? primaryForeground,
    Color? background,
    Color? foreground,
    Color? card,
    Color? elevated,
    Color? muted,
    Color? mutedForeground,
    Color? border,
    Color? success,
    Color? successForeground,
    Color? warning,
    Color? warningForeground,
    Color? destructive,
    Color? destructiveForeground,
  }) {
    return AppColors(
      primary: primary ?? this.primary,
      primaryForeground: primaryForeground ?? this.primaryForeground,
      background: background ?? this.background,
      foreground: foreground ?? this.foreground,
      card: card ?? this.card,
      elevated: elevated ?? this.elevated,
      muted: muted ?? this.muted,
      mutedForeground: mutedForeground ?? this.mutedForeground,
      border: border ?? this.border,
      success: success ?? this.success,
      successForeground: successForeground ?? this.successForeground,
      warning: warning ?? this.warning,
      warningForeground: warningForeground ?? this.warningForeground,
      destructive: destructive ?? this.destructive,
      destructiveForeground:
          destructiveForeground ?? this.destructiveForeground,
    );
  }

  @override
  AppColors lerp(ThemeExtension<AppColors>? other, double t) {
    if (other is! AppColors) return this;
    return AppColors(
      primary: Color.lerp(primary, other.primary, t)!,
      primaryForeground: Color.lerp(
        primaryForeground,
        other.primaryForeground,
        t,
      )!,
      background: Color.lerp(background, other.background, t)!,
      foreground: Color.lerp(foreground, other.foreground, t)!,
      card: Color.lerp(card, other.card, t)!,
      elevated: Color.lerp(elevated, other.elevated, t)!,
      muted: Color.lerp(muted, other.muted, t)!,
      mutedForeground: Color.lerp(mutedForeground, other.mutedForeground, t)!,
      border: Color.lerp(border, other.border, t)!,
      success: Color.lerp(success, other.success, t)!,
      successForeground: Color.lerp(
        successForeground,
        other.successForeground,
        t,
      )!,
      warning: Color.lerp(warning, other.warning, t)!,
      warningForeground: Color.lerp(
        warningForeground,
        other.warningForeground,
        t,
      )!,
      destructive: Color.lerp(destructive, other.destructive, t)!,
      destructiveForeground: Color.lerp(
        destructiveForeground,
        other.destructiveForeground,
        t,
      )!,
    );
  }
}

/// Geometry and elevation, from the same stylesheet.
class AppMetrics {
  const AppMetrics._();

  /// `--radius: 0.625rem` = 10px at the 16px root the web uses.
  static const double radius = 10;

  /// `--radius` minus 2 and 4, matching Tailwind's `md` and `sm` derivations.
  static const double radiusMd = 8;
  static const double radiusSm = 6;

  static BorderRadius get borderRadius => BorderRadius.circular(radius);

  /// `--shadow-card` in the dark theme:
  /// `0 1px 2px hsl(30 20% 2% / .4), 0 8px 24px -12px hsl(30 20% 2% / .7)`
  ///
  /// CSS's negative spread has no Flutter equivalent, so the second layer is expressed as a
  /// smaller blur at the same offset. It is an approximation and is labelled as one.
  static const List<BoxShadow> cardShadow = <BoxShadow>[
    BoxShadow(color: Color(0x66060504), offset: Offset(0, 1), blurRadius: 2),
    BoxShadow(color: Color(0xB3060504), offset: Offset(0, 8), blurRadius: 12),
  ];

  static const List<BoxShadow> elevatedShadow = <BoxShadow>[
    BoxShadow(color: Color(0x66060504), offset: Offset(0, 2), blurRadius: 4),
    BoxShadow(color: Color(0xCC060504), offset: Offset(0, 24), blurRadius: 36),
  ];

  /// The `.gradient-primary` brand mark.
  ///
  /// `linear-gradient(150deg, hsl(45 100% 62%), hsl(38 100% 50%))`. CSS measures the angle
  /// clockwise from "to top", so 150deg points down-right; those are the matching Alignments.
  ///
  /// The stylesheet restricts this: **"Brand mark only. Not a text treatment, not a button,
  /// not a card."** Use [AppColors.primary] flat for buttons.
  static const LinearGradient brandGradient = LinearGradient(
    begin: Alignment(-0.5, -1),
    end: Alignment(0.5, 1),
    colors: <Color>[Color(0xFFFFCF3D), Color(0xFFFFA100)],
  );

  /// Minimum interactive size. WCAG 2.1 AA target size is 44x44 CSS px; this app is used in
  /// gloves, so nothing interactive goes below it. DEF-013 was an undersized-target failure.
  static const double minTapTarget = 48;
}

/// Type scale.
///
/// Display is **Archivo**, body is **Inter**, both bundled as assets rather than fetched.
/// `google_fonts` is deliberately NOT used: it downloads at first run, which fails in exactly
/// the offline plant-room conditions this app is built for, and the web side self-hosts for
/// the same reason ("never @import from fonts.googleapis.com ... fails offline").
class AppFonts {
  const AppFonts._();

  static const String display = 'Archivo';
  static const String body = 'Inter';
}

class AppTheme {
  const AppTheme._();

  static ThemeData get dark => _build(AppColors.dark, Brightness.dark);
  static ThemeData get light => _build(AppColors.light, Brightness.light);

  static ThemeData _build(AppColors c, Brightness brightness) {
    final ColorScheme scheme = ColorScheme(
      brightness: brightness,
      primary: c.primary,
      onPrimary: c.primaryForeground,
      secondary: c.muted,
      onSecondary: c.foreground,
      error: c.destructive,
      onError: c.destructiveForeground,
      surface: c.card,
      onSurface: c.foreground,
      surfaceContainerHighest: c.elevated,
      outline: c.border,
    );

    final TextTheme text = _textTheme(c);

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: c.background,
      canvasColor: c.background,
      fontFamily: AppFonts.body,
      textTheme: text,
      extensions: <ThemeExtension<dynamic>>[c],
      appBarTheme: AppBarTheme(
        backgroundColor: c.card,
        foregroundColor: c.foreground,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          fontFamily: AppFonts.display,
          fontSize: 18,
          fontWeight: FontWeight.w700,
          color: c.foreground,
        ),
      ),
      dividerTheme: DividerThemeData(color: c.border, thickness: 1, space: 1),
      cardTheme: CardThemeData(
        color: c.card,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: AppMetrics.borderRadius,
          side: BorderSide(color: c.border),
        ),
        margin: EdgeInsets.zero,
      ),
      // Every CTA is Safety Yellow with near-black text. That pairing is ~11:1 in dark and
      // ~7:1 in light, so it clears WCAG AA for normal text at any size.
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: c.primary,
          foregroundColor: c.primaryForeground,
          disabledBackgroundColor: c.muted,
          disabledForegroundColor: c.mutedForeground,
          elevation: 0,
          minimumSize: const Size.fromHeight(AppMetrics.minTapTarget),
          shape: RoundedRectangleBorder(borderRadius: AppMetrics.borderRadius),
          textStyle: const TextStyle(
            fontFamily: AppFonts.body,
            fontSize: 15,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: c.foreground,
          side: BorderSide(color: c.border),
          minimumSize: const Size.fromHeight(AppMetrics.minTapTarget),
          shape: RoundedRectangleBorder(borderRadius: AppMetrics.borderRadius),
          textStyle: const TextStyle(
            fontFamily: AppFonts.body,
            fontSize: 15,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: c.primary,
          minimumSize: const Size(0, AppMetrics.minTapTarget),
          textStyle: const TextStyle(
            fontFamily: AppFonts.body,
            fontSize: 14,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: c.elevated,
        hintStyle: TextStyle(color: c.mutedForeground),
        labelStyle: TextStyle(color: c.mutedForeground),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 14,
          vertical: 16,
        ),
        border: OutlineInputBorder(
          borderRadius: AppMetrics.borderRadius,
          borderSide: BorderSide(color: c.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: AppMetrics.borderRadius,
          borderSide: BorderSide(color: c.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: AppMetrics.borderRadius,
          // `--ring` is the primary in both themes.
          borderSide: BorderSide(color: c.primary, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: AppMetrics.borderRadius,
          borderSide: BorderSide(color: c.destructive),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: AppMetrics.borderRadius,
          borderSide: BorderSide(color: c.destructive, width: 2),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: c.elevated,
        contentTextStyle: TextStyle(
          color: c.foreground,
          fontFamily: AppFonts.body,
        ),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: AppMetrics.borderRadius),
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: c.primary,
        linearTrackColor: c.muted,
      ),
      checkboxTheme: CheckboxThemeData(
        fillColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? c.primary
              : Colors.transparent,
        ),
        checkColor: WidgetStatePropertyAll<Color>(c.primaryForeground),
        side: BorderSide(color: c.border, width: 1.5),
      ),
      bottomNavigationBarTheme: BottomNavigationBarThemeData(
        backgroundColor: c.card,
        selectedItemColor: c.primary,
        unselectedItemColor: c.mutedForeground,
        type: BottomNavigationBarType.fixed,
      ),
    );
  }

  /// The fluid `--step-*` scale collapses to fixed sizes here.
  ///
  /// The CSS uses `clamp(min, preferred + vw, max)` so type grows with the viewport. A phone
  /// sits at or near the MIN of every one of those clamps, so the minimum is the honest
  /// translation — scaling type to a 400px screen the way a 1400px screen scales it would
  /// produce a display size no phone was ever meant to show.
  static TextTheme _textTheme(AppColors c) {
    return TextTheme(
      // --step-4 / --step-3, display face.
      displayLarge: TextStyle(
        fontFamily: AppFonts.display,
        fontSize: 42,
        fontWeight: FontWeight.w800,
        fontVariations: const <FontVariation>[FontVariation('wght', 800)],
        height: 1.05,
        letterSpacing: -1,
        color: c.foreground,
      ),
      displayMedium: TextStyle(
        fontFamily: AppFonts.display,
        fontSize: 32,
        fontWeight: FontWeight.w800,
        fontVariations: const <FontVariation>[FontVariation('wght', 800)],
        height: 1.1,
        letterSpacing: -0.5,
        color: c.foreground,
      ),
      displaySmall: TextStyle(
        fontFamily: AppFonts.display,
        fontSize: 28,
        fontWeight: FontWeight.w700,
        fontVariations: const <FontVariation>[FontVariation('wght', 700)],
        height: 1.12,
        letterSpacing: -0.4,
        color: c.foreground,
      ),
      // --step-2
      //
      // headlineLarge / headlineSmall are defined even though the app rarely asks for them
      // by name. An UNDEFINED entry does not fall back to a neighbouring display style — it
      // falls back to ThemeData.fontFamily, which is the BODY face. So a widget reaching for
      // headlineSmall got Inter at a heading size, and nothing failed to make that visible.
      headlineLarge: TextStyle(
        fontFamily: AppFonts.display,
        fontSize: 26,
        fontWeight: FontWeight.w700,
        fontVariations: const <FontVariation>[FontVariation('wght', 700)],
        height: 1.15,
        color: c.foreground,
      ),
      headlineMedium: TextStyle(
        fontFamily: AppFonts.display,
        fontSize: 24,
        fontWeight: FontWeight.w700,
        fontVariations: const <FontVariation>[FontVariation('wght', 700)],
        height: 1.15,
        color: c.foreground,
      ),
      headlineSmall: TextStyle(
        fontFamily: AppFonts.display,
        fontSize: 20,
        fontWeight: FontWeight.w700,
        fontVariations: const <FontVariation>[FontVariation('wght', 700)],
        height: 1.2,
        color: c.foreground,
      ),
      // --step-1
      titleLarge: TextStyle(
        fontFamily: AppFonts.display,
        fontSize: 18,
        fontWeight: FontWeight.w700,
        fontVariations: const <FontVariation>[FontVariation('wght', 700)],
        color: c.foreground,
      ),
      titleMedium: TextStyle(
        fontFamily: AppFonts.body,
        fontSize: 16,
        fontWeight: FontWeight.w600,
        fontVariations: const <FontVariation>[FontVariation('wght', 600)],
        color: c.foreground,
      ),
      // --step-0
      bodyLarge: TextStyle(
        fontFamily: AppFonts.body,
        fontWeight: FontWeight.w400,
        fontVariations: const <FontVariation>[FontVariation('wght', 400)],
        fontSize: 16,
        height: 1.5,
        color: c.foreground,
      ),
      bodyMedium: TextStyle(
        fontFamily: AppFonts.body,
        fontWeight: FontWeight.w400,
        fontVariations: const <FontVariation>[FontVariation('wght', 400)],
        fontSize: 14,
        height: 1.5,
        color: c.foreground,
      ),
      bodySmall: TextStyle(
        fontFamily: AppFonts.body,
        fontWeight: FontWeight.w400,
        fontVariations: const <FontVariation>[FontVariation('wght', 400)],
        fontSize: 13,
        height: 1.45,
        color: c.mutedForeground,
      ),
      labelLarge: TextStyle(
        fontFamily: AppFonts.body,
        fontSize: 14,
        fontWeight: FontWeight.w600,
        fontVariations: const <FontVariation>[FontVariation('wght', 600)],
        color: c.foreground,
      ),
      labelSmall: TextStyle(
        fontFamily: AppFonts.body,
        fontSize: 12,
        fontWeight: FontWeight.w500,
        fontVariations: const <FontVariation>[FontVariation('wght', 500)],
        color: c.mutedForeground,
      ),
    );
  }
}
