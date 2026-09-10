/// The design tokens in `app_theme.dart` must equal the ones in `src/app/globals.css`.
///
/// ---------------------------------------------------------------------------------------
/// WHY THIS TEST EXISTS AND WHY IT IS NOT A LIST OF HEX LITERALS
///
/// The tokens were ported by hand from HSL to ARGB, and the FIRST hand-conversion of them had
/// **22 wrong values** — colours that were close enough to look plausible in a screenshot and
/// wrong enough to be a different design. A test that simply restated
/// `expect(AppColors.dark.primary, Color(0xFFFFC61A))` would have been written from the same
/// wrong values and passed against all 22 of them. It would assert that the file equals
/// itself.
///
/// So this test never hardcodes a colour. It does two independent things:
///
///   1. **Reads `src/app/globals.css`** — the web stylesheet is the design system's single
///      source of truth — parses the `--token: H S% L%;` declarations out of the `:root`
///      (dark) and `.light` blocks, and converts them here with a fresh HSL implementation.
///      A Dart token that has drifted from the web fails.
///
///   2. **Re-derives every colour from the `// hsl(...)` comment** written beside it in
///      `app_theme.dart`, catching the specific failure that actually happened: a correct
///      comment next to a mis-converted literal.
///
/// The conversion below is written from the CSS Color Module Level 4 definition rather than
/// copied out of the app, so a bug in the app's conversion cannot hide inside the test that
/// checks it.
///
/// ---------------------------------------------------------------------------------------
/// A PATH OUT OF `mobile/` IS DELIBERATE
///
/// This test reads a file two directories up. That is unusual and it is the point: the thing
/// being verified is a CONTRACT BETWEEN TWO RUNTIMES, and a contract test that only reads its
/// own side of the contract is not a contract test. `flutter test` runs on the Dart VM with
/// full filesystem access, so this works; it is skipped with an explicit message rather than
/// silently passing if the repository layout ever changes.
library;

import 'dart:io';
import 'dart:math' as math;

import 'package:equipcert_mobile/src/theme/app_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  // Every Dart field paired with the CSS custom property it ports. Written out rather than
  // derived, because the mapping IS the claim being made: `elevated` <- `--elevated` is a
  // decision, and a reflective lookup would just assume it.
  const Map<String, String> tokenToCssVar = <String, String>{
    'primary': '--primary',
    'primaryForeground': '--primary-foreground',
    'background': '--background',
    'foreground': '--foreground',
    'card': '--card',
    'elevated': '--elevated',
    'muted': '--muted',
    'mutedForeground': '--muted-foreground',
    'border': '--border',
    'success': '--success',
    'successForeground': '--success-foreground',
    'warning': '--warning',
    'warningForeground': '--warning-foreground',
    'destructive': '--destructive',
    'destructiveForeground': '--destructive-foreground',
  };

  Map<String, Color> fieldsOf(AppColors c) => <String, Color>{
    'primary': c.primary,
    'primaryForeground': c.primaryForeground,
    'background': c.background,
    'foreground': c.foreground,
    'card': c.card,
    'elevated': c.elevated,
    'muted': c.muted,
    'mutedForeground': c.mutedForeground,
    'border': c.border,
    'success': c.success,
    'successForeground': c.successForeground,
    'warning': c.warning,
    'warningForeground': c.warningForeground,
    'destructive': c.destructive,
    'destructiveForeground': c.destructiveForeground,
  };

  group('design tokens match src/app/globals.css', () {
    final File css = File('../src/app/globals.css');

    // A missing stylesheet must fail, not skip. "Skipped because the file moved" is how a
    // contract test quietly stops testing anything.
    test('the web stylesheet is where this test expects it', () {
      expect(
        css.existsSync(),
        isTrue,
        reason:
            'Expected ${css.absolute.path}. The design tokens live there; if the web app '
            'moved, this mapping has to move with it rather than be dropped.',
      );
    });

    final String source = css.existsSync() ? css.readAsStringSync() : '';

    for (final MapEntry<String, ({String selector, AppColors colors})> scheme
        in <String, ({String selector, AppColors colors})>{
          'dark': (selector: ':root', colors: AppColors.dark),
          'light': (selector: '.light', colors: AppColors.light),
        }.entries) {
      final Map<String, String> declared = _cssVariablesIn(
        source,
        scheme.value.selector,
      );
      final Map<String, Color> dart = fieldsOf(scheme.value.colors);

      for (final MapEntry<String, String> entry in tokenToCssVar.entries) {
        test('${scheme.key}.${entry.key} == ${entry.value}', () {
          final String? hsl = declared[entry.value];
          expect(
            hsl,
            isNotNull,
            reason:
                '${entry.value} is not declared in the ${scheme.value.selector} block. '
                'Either the stylesheet dropped it or this mapping is stale.',
          );

          expect(
            dart[entry.key],
            _hslToColor(hsl!),
            reason:
                'AppColors.${scheme.key}.${entry.key} has drifted from '
                '${entry.value}: $hsl in ${scheme.value.selector}. The stylesheet wins — it '
                'is what ships to the browser and what the owner approved.',
          );
        });
      }
    }
  });

  group('every ported colour matches the hsl() comment beside it', () {
    // This is the check that would have caught the 22 bad conversions. The comments were
    // right; the literals were not.
    final File theme = File('lib/src/theme/app_theme.dart');

    test('app_theme.dart is readable', () {
      expect(theme.existsSync(), isTrue);
    });

    final List<String> lines = theme.existsSync()
        ? theme.readAsLinesSync()
        : const <String>[];

    // `field: Color(0xAARRGGBB), // hsl(H S% L%)` — the shape every token line has.
    final RegExp annotated = RegExp(
      r'^\s*(\w+)\s*:\s*Color\(0x([0-9A-Fa-f]{8})\)\s*,\s*//\s*hsl\(([^)]*)\)',
    );

    int checked = 0;
    for (int i = 0; i < lines.length; i++) {
      final RegExpMatch? match = annotated.firstMatch(lines[i]);
      if (match == null) continue;
      checked++;

      final String field = match.group(1)!;
      final int argb = int.parse(match.group(2)!, radix: 16);
      final String hsl = match.group(3)!;

      test('line ${i + 1}: $field = hsl($hsl)', () {
        expect(
          Color(argb),
          _hslToColor(hsl),
          reason:
              'The comment and the literal on line ${i + 1} disagree. One of them is a '
              'typo; the comment is the intent, so the literal is almost certainly wrong.',
        );
      });
    }

    test('the annotated-token pattern still matches something', () {
      // If a refactor changes the comment style, every check above silently disappears and
      // the suite still reports green. This is the tripwire for that.
      expect(
        checked,
        greaterThanOrEqualTo(20),
        reason:
            'Only $checked annotated colour literals were found in app_theme.dart. The '
            'checks above are generated from that pattern, so a formatting change would '
            'delete them all without failing anything.',
      );
    });
  });

  group('accessibility floors that the tokens have to hold', () {
    // These are not style opinions. EN 301 549 points at WCAG 2.1 AA, the European
    // Accessibility Act deadline passed on 2025-06-28, and DEF-013 was an accessibility
    // failure that shipped. Contrast is checkable, so it is checked.
    for (final MapEntry<String, AppColors> scheme in <String, AppColors>{
      'dark': AppColors.dark,
      'light': AppColors.light,
    }.entries) {
      final AppColors c = scheme.value;

      test('${scheme.key}: body text on the page background >= 4.5:1', () {
        expect(
          _contrast(c.foreground, c.background),
          greaterThanOrEqualTo(4.5),
        );
      });

      test('${scheme.key}: body text on a card >= 4.5:1', () {
        expect(_contrast(c.foreground, c.card), greaterThanOrEqualTo(4.5));
      });

      test('${scheme.key}: secondary text on the page background >= 4.5:1', () {
        // The muted foreground is the one that usually fails. It is used for timestamps and
        // helper text, which WCAG treats no differently from any other body copy.
        expect(
          _contrast(c.mutedForeground, c.background),
          greaterThanOrEqualTo(4.5),
        );
      });

      test('${scheme.key}: primary button label on primary >= 4.5:1', () {
        expect(
          _contrast(c.primaryForeground, c.primary),
          greaterThanOrEqualTo(4.5),
        );
      });

      // The status colours are used as TEXT throughout both clients (`text-success`,
      // `text-warning`, `text-destructive` on the web; the same tokens here), so the
      // applicable floor is WCAG 1.4.3's 4.5:1 for body text — not the 3:1 non-text floor.
      //
      // These were three recorded failures (DEF-046), pinned here at the ratios they measured
      // at so they could not get worse. **All six now pass in both directions**, so the pins
      // are gone and the real floor applies unconditionally. Do not reintroduce a
      // known-failure map: an accessibility exception that lives in the test is an exception
      // nobody ever removes.
      for (final MapEntry<String, Color> status in <String, Color>{
        'success': c.success,
        'warning': c.warning,
        'destructive': c.destructive,
      }.entries) {
        test('${scheme.key}: ${status.key} used as text >= 4.5:1', () {
          final double measured = _contrast(status.value, c.background);

          expect(
            measured,
            greaterThanOrEqualTo(4.5),
            reason:
                '${scheme.key}.${status.key} measures '
                '${measured.toStringAsFixed(3)}:1 against the page background. It is '
                'rendered as text, so WCAG 1.4.3 applies. See DEF-046.',
          );
        });
      }

      // THE DIRECTION DEF-046 ORIGINALLY MISSED.
      //
      // A semantic colour is not only text on a neutral surface — it is also a SOLID button
      // and badge background with its own `-foreground` written on it. On the web that is
      // `bg-success text-success-foreground`, whose most important instance is `touch-success`
      // and `touch-fail`: the PASS and FAIL buttons in the technician flow.
      //
      // Measuring only the text direction hid three further failures, the worst of them white
      // on the dark PASS green at 2.922:1. The two directions pull against each other — fixing
      // one by moving lightness breaks the other — so both are asserted here, and the
      // `-foreground` tokens were re-chosen rather than assumed to be white.
      for (final MapEntry<String, List<Color>> pair in <String, List<Color>>{
        'success': <Color>[c.successForeground, c.success],
        'warning': <Color>[c.warningForeground, c.warning],
        'destructive': <Color>[c.destructiveForeground, c.destructive],
      }.entries) {
        test('${scheme.key}: ${pair.key}Foreground on solid ${pair.key} >= 4.5:1', () {
          final double measured = _contrast(pair.value[0], pair.value[1]);

          expect(
            measured,
            greaterThanOrEqualTo(4.5),
            reason:
                'the label on a solid ${pair.key} button measures '
                '${measured.toStringAsFixed(3)}:1. For success and destructive this pair '
                'is the PASS/FAIL control in the technician flow. DEF-046.',
          );
        });
      }

      test('${scheme.key}: status colours clear the 3:1 non-text floor', () {
        // Kept even though the 4.5:1 text floor above now subsumes it: 1.4.11 governs the
        // icon and border treatments, which is a different obligation that would survive a
        // future decision to treat one of these as large text.
        final Map<String, double> ratios = <String, double>{
          'success': _contrast(c.success, c.background),
          'warning': _contrast(c.warning, c.background),
          'destructive': _contrast(c.destructive, c.background),
        };

        final Iterable<String> below = ratios.entries
            .where((MapEntry<String, double> e) => e.value < 3.0)
            .map(
              (MapEntry<String, double> e) =>
                  '${e.key} ${e.value.toStringAsFixed(3)}:1',
            );

        expect(
          below,
          isEmpty,
          reason: 'DEF-046 — no status colour may fall below 1.4.11.',
        );
      });
    }
  });

  group('theme wiring', () {
    test('AppColors is attached to both ThemeData objects', () {
      // Every screen reads its colours through `Theme.of(context).extension<AppColors>()`.
      // If the extension is not registered that returns null and the UI falls back to
      // Material defaults — purple — which is a total design failure that compiles.
      expect(AppTheme.dark.extension<AppColors>(), same(AppColors.dark));
      expect(AppTheme.light.extension<AppColors>(), same(AppColors.light));
    });

    test('the scaffold background is the token, not a Material default', () {
      expect(AppTheme.dark.scaffoldBackgroundColor, AppColors.dark.background);
      expect(
        AppTheme.light.scaffoldBackgroundColor,
        AppColors.light.background,
      );
    });

    test('brightness is declared correctly on each', () {
      expect(AppTheme.dark.brightness, Brightness.dark);
      expect(AppTheme.light.brightness, Brightness.light);
    });

    test('the bundled families are used, not a system fallback', () {
      // A typo here does not throw; Flutter silently substitutes Roboto and the whole type
      // scale renders in the wrong face.
      expect(AppTheme.dark.textTheme.bodyMedium?.fontFamily, AppFonts.body);
      expect(
        AppTheme.dark.textTheme.headlineSmall?.fontFamily,
        AppFonts.display,
      );
    });

    test('every text style pairs fontWeight with a matching fontVariation', () {
      // Both families are VARIABLE fonts. `fontWeight` alone does not move a variable axis —
      // the text renders at the default weight and the hierarchy flattens, with nothing
      // failing. See the pubspec comment.
      final List<TextStyle> styles = <TextStyle?>[
        AppTheme.dark.textTheme.displayLarge,
        AppTheme.dark.textTheme.displayMedium,
        AppTheme.dark.textTheme.headlineLarge,
        AppTheme.dark.textTheme.headlineMedium,
        AppTheme.dark.textTheme.headlineSmall,
        AppTheme.dark.textTheme.titleLarge,
        AppTheme.dark.textTheme.titleMedium,
        AppTheme.dark.textTheme.bodyLarge,
        AppTheme.dark.textTheme.bodyMedium,
        AppTheme.dark.textTheme.bodySmall,
        AppTheme.dark.textTheme.labelLarge,
      ].whereType<TextStyle>().toList();

      expect(styles, isNotEmpty);

      for (final TextStyle style in styles) {
        final FontWeight? weight = style.fontWeight;
        if (weight == null) continue;

        final List<FontVariation> variations =
            style.fontVariations ?? const <FontVariation>[];
        final FontVariation wght = variations.firstWhere(
          (FontVariation v) => v.axis == 'wght',
          orElse: () => const FontVariation('none', -1),
        );

        expect(
          wght.value.round(),
          _numericWeight(weight),
          reason:
              'A style asks for $weight but its wght axis is ${wght.value}. On a variable '
              'font the axis is what actually renders.',
        );
      }
    });

    test('the minimum tap target is at least the WCAG 2.1 AA size', () {
      // 44x44 CSS px is the AA floor. This app is used in gloves, hence 48.
      expect(AppMetrics.minTapTarget, greaterThanOrEqualTo(44));
    });
  });
}

/// Parse `--name: value;` declarations from one CSS block.
///
/// Deliberately simple: it finds the selector, takes everything to the first closing brace,
/// and reads declarations out of that. The stylesheet nests these inside `@layer base`, so a
/// real CSS parser would be the correct tool if the shape ever gets more complicated — but a
/// dependency-free reader that fails loudly when it finds nothing is better than adding a
/// package to read fifteen numbers.
Map<String, String> _cssVariablesIn(String source, String selector) {
  final int start = source.indexOf('$selector {');
  if (start < 0) return const <String, String>{};

  final int end = source.indexOf('}', start);
  final String block = source.substring(start, end < 0 ? source.length : end);

  final Map<String, String> out = <String, String>{};
  for (final RegExpMatch match in RegExp(
    r'(--[a-z0-9-]+)\s*:\s*([^;]+);',
    caseSensitive: false,
  ).allMatches(block)) {
    out[match.group(1)!] = match.group(2)!.trim();
  }
  return out;
}

/// `H S% L%` (the Tailwind bare-triple form) or a full `hsl(...)` body -> [Color].
///
/// Written from the CSS Color Module Level 4 algorithm. Not shared with the app: this test
/// exists to disagree with the app when the app is wrong, which it cannot do if it calls the
/// same code.
Color _hslToColor(String value) {
  final List<String> parts = value
      .replaceAll('%', '')
      .replaceAll(',', ' ')
      .trim()
      .split(RegExp(r'\s+'))
      .where((String p) => p.isNotEmpty && p != '/')
      .toList();

  if (parts.length < 3) {
    throw FormatException('Not an HSL triple: "$value"');
  }

  final double h = double.parse(parts[0]) % 360;
  final double s = double.parse(parts[1]) / 100;
  final double l = double.parse(parts[2]) / 100;

  final double c = (1 - (2 * l - 1).abs()) * s;
  final double x = c * (1 - ((h / 60) % 2 - 1).abs());
  final double m = l - c / 2;

  final (double r, double g, double b) rgb = switch (h) {
    < 60 => (c, x, 0.0),
    < 120 => (x, c, 0.0),
    < 180 => (0.0, c, x),
    < 240 => (0.0, x, c),
    < 300 => (x, 0.0, c),
    _ => (c, 0.0, x),
  };

  int channel(double v) => ((v + m) * 255).round().clamp(0, 255);

  return Color.fromARGB(255, channel(rgb.$1), channel(rgb.$2), channel(rgb.$3));
}

/// WCAG 2.1 relative luminance.
double _luminance(Color color) {
  double linear(double channel) => channel <= 0.03928
      ? channel / 12.92
      : math.pow((channel + 0.055) / 1.055, 2.4).toDouble();

  // `.r`/`.g`/`.b` are the 0..1 doubles on the wide-gamut Color API. The deprecated integer
  // `.red`/`.green`/`.blue` getters are gone in current Flutter.
  return 0.2126 * linear(color.r) +
      0.7152 * linear(color.g) +
      0.0722 * linear(color.b);
}

/// WCAG 2.1 contrast ratio between two opaque colours.
double _contrast(Color a, Color b) {
  final double la = _luminance(a);
  final double lb = _luminance(b);
  final double lighter = la > lb ? la : lb;
  final double darker = la > lb ? lb : la;
  return (lighter + 0.05) / (darker + 0.05);
}

/// `FontWeight.w600` -> 600.
int _numericWeight(FontWeight weight) =>
    (FontWeight.values.indexOf(weight) + 1) * 100;
