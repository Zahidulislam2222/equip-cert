# Design — how to use the EquipCert design system

This file explains **how** to use the design system. It holds no values. Every colour, size,
radius and shadow is defined once, in the files below; read the value there, never copy it here
or into a component.

| What | Sole owner |
|---|---|
| Web colour, radius, shadow and type-scale tokens | `src/app/globals.css` (`:root` = dark default, `.light` = light) |
| Tailwind names for those tokens | `tailwind.config.ts` |
| Fonts | `src/app/layout.tsx` (Archivo display, Inter body) |
| Flutter colours | `mobile/lib/src/theme/app_theme.dart`, read through `colorsOf(context)` |
| Hero film camera and labels | `src/content/inspection-flight.json` |

## The look, in one paragraph

Dark first. Warm near-black surfaces, not blue-grey. One accent — Safety Yellow — used for the
primary action, focus rings and the few things that must be found first. Archivo for headings,
Inter for body text. The light theme exists and must stay correct, but dark is what ships.

## Rules for new UI

1. **Use a token, never a literal.** `bg-background`, `text-foreground`, `bg-primary`,
   `text-muted-foreground`, `border-border`, `ring-ring`. A hex value, an `rgb()` or a raw
   Tailwind palette class (`bg-red-100`, `text-blue-700`) in a component is a defect.
   The one deliberate exception is the signature pad's PNG export (black on white, because it is
   printed evidence, not UI).
2. **The semantic three are for inspection state only.** `success` = pass, `warning` = due /
   attention, `destructive` = fail / overdue / irreversible. Never decoration, never a brand colour.
3. **Pair every background token with its `-foreground` token.** They are not all white; the
   pairings are WCAG results (DEF-046). `mobile/test/theme_tokens_test.dart` fails if one drifts.
4. **Type sizes come from the step scale** (`text-step-0` … `text-step-5`), not arbitrary sizes.
5. **Elevation comes from `shadow-sm`, `shadow-card`, `shadow-elevated`** and the `glass` utility.
6. **Reuse before you add.** Buttons and badges: `src/components/ui/`. Motion: `src/components/motion/`
   (`MotionPage`, `FadeInView`, `StaggerGrid`, `MotionCard`, `AnimatedCounter`). Add a component or
   token only when nothing existing fits, and add it to the owner file, not locally.

## Motion and accessibility rules (each one came from a defect)

- **Never gate the critical path behind an animation.** Forms, CTAs and content render visible from
  HTML; decoration may fade in (DEF-012).
- **Respect `prefers-reduced-motion`.** Every scroll and entrance effect has a static fallback.
- **Measure contrast against the composite**, not the flat token — text over the hero film is
  checked by `npm run test:contrast` against `.flight-scrim` (WCAG 1.4.3).
- **Targets are at least 24×24 CSS px**, and pinch-zoom is never disabled (DEF-011, DEF-013).
- **Every data view has loading, empty and error states.**

## Changing the visual design

The web visual design is fenced by the owner (DEF-041). A token value, font, layout or motion change
needs the owner's explicit approval in the task, the way the DEF-046 contrast fix was approved.
Accessibility fixes that keep hue and saturation (lightness only) were the precedent.
