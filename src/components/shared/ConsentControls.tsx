'use client';

// Withdrawal control for Settings.
//
// This exists because the banner promises it exists. DEF-029: the previous banner said "You
// can change this anytime in Settings" and nothing in Settings read or wrote the consent key,
// so a user who accepted could not withdraw without clearing browser storage by hand. Under
// GDPR Art. 7(3) withdrawal must be as easy as granting, and a documented false statement to
// the data subject is worse than saying nothing.
//
// Withdrawing here does not merely flip a flag — it purges the optional keys that were stored
// under the old decision. A "preferences: false" flag sitting next to a still-present theme
// key is a promise of withdrawal, not withdrawal.

import { useEffect, useState } from 'react';
import { ShieldCheck, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  consentCopy,
  readConsent,
  writeConsent,
  hasGpcSignal,
  denyAllOptional,
  grantAllOptional,
  type ConsentDecision,
} from '@/lib/compliance/consent';
import { recordStorageConsent } from '@/lib/compliance/consent-record';
import { useAuth } from '@/components/auth/AuthProvider';

export function ConsentControls() {
  const { profile, organization } = useAuth();
  const [decision, setDecision] = useState<ConsentDecision | null>(null);
  const [gpc, setGpc] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // localStorage and navigator do not exist when this page is statically exported, so the
    // stored decision genuinely cannot be known until after mount. This is the documented
    // exception the rule exists to flag, not an accidental cascade — same pattern as
    // ThemeToggle. One synchronous pass, no dependency on rendered output.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDecision(readConsent());
    setGpc(hasGpcSignal());
    setMounted(true);
  }, []);

  const apply = (categories: Record<string, boolean>) => {
    const next = writeConsent(categories, false);
    setDecision(next);
    void recordStorageConsent(next, profile?.id, organization?.id);
  };

  const optionalGranted =
    decision !== null &&
    Object.entries(decision.categories).some(([id, v]) => id !== 'essential' && v === true);

  return (
    <div className="rounded-lg border border-border bg-card p-6 shadow-card">
      <div className="mb-4 flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
        <h3 className="font-display text-lg font-semibold text-foreground">
          {consentCopy.settings.heading}
        </h3>
      </div>

      <p className="text-sm leading-relaxed text-muted-foreground">
        {consentCopy.settings.body}
      </p>

      {gpc && (
        <p
          role="status"
          className="mt-4 rounded-md border border-success/40 bg-success/5 px-3 py-2 text-xs font-medium text-foreground"
        >
          {consentCopy.gpc.heading} — {consentCopy.gpc.body}
        </p>
      )}

      {/* Rendered only after mount: the stored decision is per-browser, so server-rendered
          markup cannot know it, and claiming a state before reading it would be a guess. */}
      {mounted && (
        <>
          <p className="mt-4 text-sm font-medium text-foreground">
            {decision === null
              ? consentCopy.settings.never
              : optionalGranted
                ? consentCopy.settings.currentGranted
                : consentCopy.settings.currentDenied}
          </p>

          {decision && (
            <p className="mt-1 text-xs text-muted-foreground">
              {consentCopy.settings.recordedAt}:{' '}
              <time dateTime={decision.decidedAt}>
                {new Date(decision.decidedAt).toLocaleString()}
              </time>
              {decision.viaGpc && ' (via Global Privacy Control)'}
            </p>
          )}

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 gap-2 rounded-lg text-xs"
              onClick={() => apply(denyAllOptional())}
              disabled={decision !== null && !optionalGranted}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              {consentCopy.settings.withdraw}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1 rounded-lg text-xs"
              onClick={() => apply(grantAllOptional())}
              disabled={optionalGranted}
            >
              {consentCopy.settings.grant}
            </Button>
          </div>

          <ul className="mt-4 space-y-2 border-t border-border pt-4">
            {consentCopy.categories.map((category) => (
              <li key={category.id} className="text-xs">
                <span className="font-semibold text-foreground">{category.name}</span>
                <span className="ml-2 text-muted-foreground">
                  {category.required
                    ? 'always active'
                    : decision?.categories?.[category.id] === true
                      ? 'on'
                      : 'off'}
                </span>
                <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground/80">
                  {category.items}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
