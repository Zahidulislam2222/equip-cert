# Accessibility

**Target:** WCAG 2.1 Level AA — the benchmark US courts apply under ADA Title III, the standard
ADA Title II requires of public-sector customers by 2027–2028, and the level EN 301 549 points to
in Europe. See the [legal map](compliance/README.md) §7.

**Status (2026-09-24): partially conformant, self-assessed.** No third-party audit has been done,
so no conformance claim is made. The audit is on the [roadmap](ROADMAP.md), Phase 2.

---

## What is built and tested

| Practice | Where | Evidence |
|---|---|---|
| **Contrast is a test, not a taste.** Theme tokens are checked against WCAG ratios (4.5:1 body text, 3:1 large text and UI) in both light and dark schemes | `src/app/globals.css` is the single owner; `mobile/test/theme_tokens_test.dart` parses it | Six tokens that failed — including white on the dark PASS button at 2.9:1 — were relit, keeping hue and saturation (DEF-046) |
| **Contrast measured over the real background.** Hero copy is checked against the rendered video frames it sits on, not a flat colour | `npm run test:contrast` | Body text that passed on the flat background failed at 4.17:1 over the film; a scrim fixed it |
| **The list is the truth, the film is the presentation.** Every hero beat's copy lives in a semantic ordered list in reading order | `src/components/scroll/` | Screen readers, phones, reduced-motion users and failed video all get the same content |
| **Reduced motion respected** | `prefers-reduced-motion` handled across the motion components | Animations stop; content stays |
| **Critical paths never wait on animation.** Forms and calls to action render visible from HTML | Sign-in, sign-up | Earlier, the sign-in form sat inside three `opacity: 0` wrappers — if animation failed, nobody could log in (DEF-012) |
| **Skip link** on the landing page, `lang="en"` on every page, `aria-label` / `aria-expanded` / `aria-pressed` on interactive widgets | `src/app/page.tsx`, `src/app/layout.tsx` | — |
| **Consent choices at equal prominence** | Cookie banner | Also a legal requirement; the reject path is as easy as accept |
| **A stalled video falls back** to a still image plus the text list | Hero | An 8-second budget; `error` alone does not fire for every failure |

## Known gaps

| Gap | Impact | Plan |
|---|---|---|
| No automated accessibility checks (e.g. axe) in CI | Regressions caught only by manual review | Add to CI with the web test suite |
| No screen-reader walkthrough of the manager dashboard and technician flow | Unknown issues likely in data tables and charts | Part of the audit |
| The signature pad needs pointer or touch drawing | Harder for users with limited fine motor control | Offer a typed-name signature with the same consent and attribution |
| The skip link exists on the landing page only, not in the app shell | Keyboard users tab through the navigation on every app page | Move it into the shared layout |
| Charts convey some information visually | Needs text alternatives or data tables | Part of the audit |
| Flutter screens beyond the AI disclosure have no widget tests for semantics | Labels and focus order unverified on mobile | Add semantics tests |

## Feedback

If something in EquipCert AI is hard to use with assistive technology, please
[open an issue](https://github.com/Zahidulislam2222/equip-cert/issues/new) describing the page,
what you expected, and the tools you use. Do not include personal data.
