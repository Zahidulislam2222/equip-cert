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
// Copy comes from src/content/consent.json via the consent module.

import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
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

export function CookieConsent() {
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

    if (!existing) setShow(true);
  }, [persist]);

  const decide = (categories: Record<string, boolean>) => {
    persist(categories, false);
    setShow(false);
  };

  if (showGpcNotice) {
    return (
      <div className="fixed bottom-4 left-4 right-4 z-50 sm:left-auto sm:max-w-sm">
        <div
          role="status"
          className="rounded-lg border border-success/40 bg-card p-4 shadow-elevated"
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
    <div className="fixed bottom-4 left-4 right-4 z-50 sm:left-auto sm:max-w-lg">
      <div
        role="dialog"
        aria-modal="false"
        aria-labelledby="consent-heading"
        className="rounded-lg border border-border bg-card p-5 shadow-elevated"
      >
        <div className="mb-4 flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <h2 id="consent-heading" className="text-sm font-semibold text-foreground">
              {consentCopy.banner.heading}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {consentCopy.banner.body}
            </p>
            <p className="mt-2 text-xs font-medium leading-relaxed text-foreground">
              {consentCopy.banner.noTracking}
            </p>
          </div>
        </div>

        {expanded && (
          <ul className="mb-4 space-y-3 border-t border-border pt-4">
            {consentCopy.categories.map((category) => (
              <li key={category.id} className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id={`consent-${category.id}`}
                  className="mt-1 h-4 w-4 shrink-0 accent-primary"
                  checked={category.required ? true : selection[category.id] === true}
                  disabled={category.required}
                  onChange={(e) =>
                    setSelection((prev) => ({ ...prev, [category.id]: e.target.checked }))
                  }
                />
                <label htmlFor={`consent-${category.id}`} className="cursor-pointer">
                  <span className="block text-xs font-semibold text-foreground">
                    {category.name}
                    {category.required && (
                      <span className="ml-2 font-normal text-muted-foreground">
                        (always active)
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                    {category.description}
                  </span>
                  <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground/80">
                    {category.items}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        {/* Equal prominence: identical variant, identical size, identical width, one click
            each, same layer. Do not restyle one of these without the other. */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 rounded-lg text-xs"
            onClick={() => decide(denyAllOptional())}
          >
            {consentCopy.banner.rejectAll}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 rounded-lg text-xs"
            onClick={() => decide(grantAllOptional())}
          >
            {consentCopy.banner.acceptAll}
          </Button>
          {expanded ? (
            <Button
              size="sm"
              variant="outline"
              className="flex-1 rounded-lg text-xs"
              onClick={() => decide(selection)}
            >
              {consentCopy.banner.save}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="flex-1 rounded-lg text-xs"
              onClick={() => setExpanded(true)}
            >
              {consentCopy.banner.manage}
            </Button>
          )}
        </div>

        <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
          You can change this at any time in Settings. We honour{' '}
          <a
            href="https://globalprivacycontrol.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Global Privacy Control
          </a>{' '}
          automatically.{' '}
          <a href="/privacy" className="underline">
            {consentCopy.banner.policyLink}
          </a>{' · '}
          {/* The banner is where most people first learn they have rights here, so it is where
              the control to exercise them has to be reachable — GDPR Art. 12(2) is about
              facilitating the right, and a link two pages away facilitates nothing. */}
          <a href="/privacy/requests" className="underline">
            {consentCopy.banner.rightsLink}
          </a>
        </p>
      </div>
    </div>
  );
}
