'use client';

// Consent banner.
//
// Design constraints that are legal requirements, not preferences:
//
//  - "Reject optional" and "Accept all" are the SAME element type, size and variant, on the
//    SAME layer, reachable in the SAME single click. The EDPB treats a reject option that is
//    smaller, greyer or one layer deeper as a dark pattern that invalidates the consent, and
//    CNIL, the Garante and the AEPD have all fined on exactly this.
//  - Nothing optional is stored before a decision. Default state is deny.
//  - When Global Privacy Control is present we do not merely honour it silently. From
//    1 Jan 2026 the consumer must be able to CONFIRM the signal was processed, so a visible
//    "Opt-Out Preference Signal Honored" notice renders. Hidden confirmation does not count.
//  - No entrance animation gates it (DEF-012): if the animation never runs, the notice must
//    still be there.
//
// Design constraints that are PRODUCT requirements, learned by breaking them (DEF-041):
//
//  - Equal prominence is a rule about the three buttons relative to EACH OTHER. It says
//    nothing about how much of the page the card covers. A previous revision read it as a
//    licence to grow — two body paragraphs, an inline category list and three links in the
//    first layer — and the resulting card sat on top of the hero's 3-D controls and the
//    inspection record. A compliance control that hides the product is a defect in both
//    directions: the page looks broken, and a notice people resent is a notice they dismiss
//    without reading, which is worse consent, not better.
//  - So the first layer carries the minimum a person needs to decide — what is stored, that
//    nothing tracks them, three equal buttons, and the two links Art. 12(2)/13 require. Every
//    further word lives one click away behind "Customise", which is where the detail belongs
//    and where nobody's first impression of the product is.
//  - It docks bottom-LEFT and above the record strip, because the hero's interactive controls
//    live bottom-right. Overlap is unavoidable for any fixed overlay; overlapping empty film
//    instead of the controls is the whole of the choice.
//
// Copy comes from src/content/consent.json via the consent module.

import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { ShieldCheck, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { config } from '@/lib/config';
import {
  consentCopy,
  readConsent,
  writeConsent,
  hasGpcSignal,
  denyAllOptional,
  grantAllOptional,
  purgePreferenceStorage,
  type ConsentDecision,
} from '@/lib/compliance/consent';
import { recordStorageConsent } from '@/lib/compliance/consent-record';
import { useAuth } from '@/components/auth/AuthProvider';

/** Bottom-left dock, clear of the hero's bottom-right control cluster and record strip. */
// The offset was measured, not chosen: the inspection record strip is ~129px tall at 1920,
// so the dock sits 160px up and keeps a real margin if that strip ever grows a row.
const DOCK = 'fixed bottom-4 left-4 right-4 z-50 sm:bottom-40 sm:left-6 sm:right-auto sm:w-[22rem]';

/** All three decision buttons. Identical by construction — one class string, one place. */
const DECISION_BUTTON = 'h-8 w-full rounded-md px-2 text-[11px]';

// Routes that store nothing optional, so there is nothing on them to consent to.
//
// This is not a cosmetic exemption and it is not a route whitelist that can quietly grow.
// Consent is required BEFORE optional storage, and the marketing landing page performs none:
// ThemeToggle is not mounted there, and the Preloader's intro-seen flag is already gated on
// `isGranted('preferences')`, which is false until a decision exists. So the page writes
// strictly necessary storage only — lawful under ePrivacy Art. 5(3) and GDPR Art. 6(1)(f)
// without consent.
//
// Interrupting a first-time visitor to ask permission for storage you are not performing is
// not extra caution. It trains people to dismiss the notice unread, and it is what put a card
// on top of the hero (DEF-041). The notice appears the moment the visitor reaches a route
// where optional storage is actually reachable — every /auth and /app route, where the theme
// control lives — which is still before anything optional is written.
//
// THE INVARIANT, for whoever edits this next: a route may only appear here while it stores
// nothing optional. Mount ThemeToggle on the landing page, or add any optional write to it,
// and this entry must come out in the same commit.
const NO_OPTIONAL_STORAGE_ROUTES = new Set(['/']);

export function CookieConsent() {
  const pathname = usePathname();
  const { profile, organization } = useAuth();
  const [show, setShow] = useState(false);
  const [showGpcNotice, setShowGpcNotice] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [selection, setSelection] = useState<Record<string, boolean>>(denyAllOptional);

  const persist = useCallback(
    (categories: Record<string, boolean>, viaGpc: boolean): ConsentDecision => {
      const decision = writeConsent(categories, viaGpc);
      // Audit trail is best-effort and deliberately not awaited: the user's choice is already
      // in effect locally, and a slow network must not delay honouring it.
      void recordStorageConsent(decision, profile?.id, organization?.id);
      return decision;
    },
    [profile?.id, organization?.id],
  );

  useEffect(() => {
    const existing = readConsent();

    if (hasGpcSignal()) {
      // A GPC signal is a legally recognised opt-out. Record it, purge anything optional that
      // a previous session stored, and TELL the user — the confirmation is the new duty.
      if (!existing || existing.viaGpc !== true) {
        persist(denyAllOptional(), true);
      }
      purgePreferenceStorage();
      // Same exception as ConsentControls: the GPC signal and any stored decision are
      // browser-only facts that a static export cannot know until mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowGpcNotice(true);
      setShow(false);
      return;
    }

    if (existing) return;

    // Late, never conditional. The timer only decides WHEN the notice arrives; it cannot
    // decide whether it arrives, and nothing optional is written while it runs.
    const timer = setTimeout(() => setShow(true), config.consent.bannerDelayMs);
    return () => clearTimeout(timer);
  }, [persist]);

  const decide = (categories: Record<string, boolean>) => {
    persist(categories, false);
    setShow(false);
  };

  // Suppress the NOTICE, never the machinery. The effect above still runs on these routes: a
  // GPC signal is still recorded and any optional storage a previous session left behind is
  // still purged. Only the card waits for a route where the question is real — so nothing that
  // protects the visitor is skipped, just the interruption that protects nothing.
  if (NO_OPTIONAL_STORAGE_ROUTES.has(pathname)) return null;

  if (showGpcNotice) {
    return (
      <div className={DOCK}>
        <div
          role="status"
          className="rounded-lg border border-success/40 bg-card/95 p-4 shadow-elevated backdrop-blur-sm"
        >
          <div className="flex items-start gap-3">
            <Check className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-foreground">
                {consentCopy.gpc.heading}
              </h2>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {consentCopy.gpc.body}
              </p>
            </div>
            <button
              onClick={() => setShowGpcNotice(false)}
              className="ml-auto shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
              aria-label="Dismiss confirmation"
            >
              OK
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!show) return null;

  return (
    <div className={DOCK}>
      <div
        role="dialog"
        aria-modal="false"
        aria-labelledby="consent-heading"
        // The expanded layer grows upward from a fixed bottom edge, so it is capped and
        // scrolls rather than running off the top of a short viewport.
        className="max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-card/95 p-4 shadow-elevated backdrop-blur-sm"
      >
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <h2 id="consent-heading" className="text-sm font-semibold text-foreground">
            {consentCopy.banner.heading}
          </h2>
        </div>

        {/* First layer: what is stored and that nothing tracks you. One sentence, because a
            person deciding in two seconds reads one sentence and a wall of text is read by
            nobody — Art. 12(1) asks for concise and intelligible, not for exhaustive. */}
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {consentCopy.banner.summary}
        </p>

        {expanded && (
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {consentCopy.banner.body}
            </p>
            <p className="mt-2 text-[11px] font-medium leading-relaxed text-foreground">
              {consentCopy.banner.noTracking}
            </p>

            <ul className="mt-3 space-y-3">
              {consentCopy.categories.map((category) => (
                <li key={category.id} className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    id={`consent-${category.id}`}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                    checked={category.required ? true : selection[category.id] === true}
                    disabled={category.required}
                    onChange={(e) =>
                      setSelection((prev) => ({ ...prev, [category.id]: e.target.checked }))
                    }
                  />
                  <label htmlFor={`consent-${category.id}`} className="cursor-pointer">
                    <span className="block text-[11px] font-semibold text-foreground">
                      {category.name}
                      {category.required && (
                        <span className="ml-1.5 font-normal text-muted-foreground">
                          (always active)
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">
                      {category.description}
                    </span>
                    <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground/80">
                      {category.items}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Equal prominence: identical variant, identical size, identical width, one click
            each, same layer. They share DECISION_BUTTON so the three cannot drift apart in a
            later edit — the failure mode the EDPB actually fines for is one button quietly
            becoming less inviting than another. */}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Button
            size="sm"
            variant="outline"
            className={DECISION_BUTTON}
            onClick={() => decide(denyAllOptional())}
          >
            {consentCopy.banner.rejectAll}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className={DECISION_BUTTON}
            onClick={() => decide(grantAllOptional())}
          >
            {consentCopy.banner.acceptAll}
          </Button>
          {expanded ? (
            <Button
              size="sm"
              variant="outline"
              className={DECISION_BUTTON}
              onClick={() => decide(selection)}
            >
              {consentCopy.banner.save}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className={DECISION_BUTTON}
              onClick={() => setExpanded(true)}
            >
              {consentCopy.banner.manage}
            </Button>
          )}
        </div>

        <p className="mt-2.5 text-[10px] leading-relaxed text-muted-foreground">
          <a href="/privacy" className="underline">
            {consentCopy.banner.policyLink}
          </a>
          {' · '}
          {/* The banner is where most people first learn they have rights here, so it is where
              the control to exercise them has to be reachable — GDPR Art. 12(2) is about
              facilitating the right, and a link two pages away facilitates nothing. */}
          <a href="/privacy/requests" className="underline">
            {consentCopy.banner.rightsLink}
          </a>
          {' · '}
          <a
            href="https://globalprivacycontrol.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Global Privacy Control
          </a>{' '}
          honoured automatically. Changeable any time in Settings.
        </p>
      </div>
    </div>
  );
}
