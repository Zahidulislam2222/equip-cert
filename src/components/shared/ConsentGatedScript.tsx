'use client';

// The only lawful way to load a third-party advertising or CRM tag in this codebase.
//
// WHY THIS EXISTS AS A COMPONENT rather than a comment telling people to be careful:
//
// ePrivacy Art. 5(3) requires consent BEFORE anything is stored on or read from the visitor's
// device, and the EDPB is explicit that "load the tag, then ask" is not consent — by the time
// the banner renders, the pixel has already set `_fbp` and reported the pageview. Every fine in
// this area is for that ordering, not for missing paperwork. A rule that lives only in a
// developer's memory gets broken by the next person in a hurry; a component that has no code
// path to inject before `isGranted` returns true cannot be broken by being forgotten.
//
// It also handles the half nobody implements: WITHDRAWAL. Art. 7(3) says withdrawing must be as
// easy as granting, which in practice means as effective. Turning the tag off has to remove the
// element, drop the globals it installed, and delete the cookies it set — otherwise the
// identifier stays on the device and the next request to that vendor still carries it. This
// component does all three, and re-runs whenever the stored decision changes.
//
// Meta specifically: embedding their pixel makes this site a JOINT CONTROLLER with Meta for the
// collection and transmission stage (CJEU C-40/17, Fashion ID). That needs an Art. 26
// arrangement and a transfer basis for the US, both of which are legal work that no component
// can do for you. The checklist is in memory/RESUME.md; this file only guarantees the ordering.

import { useEffect, useState } from 'react';
import {
  isGranted,
  readConsent,
  MARKETING_CATEGORY_ID,
  purgeMarketingStorage,
  CONSENT_CHANGED_EVENT,
} from '@/lib/compliance/consent';

export interface ConsentGatedScriptProps {
  /** Stable id, used to find and remove the element on withdrawal. */
  id: string;
  /** External script URL. Provide this or `inline`, not both. */
  src?: string;
  /** Inline bootstrap code, for vendors whose snippet defines a queue before the CDN loads. */
  inline?: string;
  /** Consent category that must be granted. Defaults to `marketing`. */
  category?: string;
  /** Globals the vendor installs, deleted from `window` on withdrawal. */
  globals?: readonly string[];
}

export function ConsentGatedScript({
  id,
  src,
  inline,
  category = MARKETING_CATEGORY_ID,
  globals = [],
}: ConsentGatedScriptProps) {
  // Deny is the only safe initial value. A static export renders this on the server where no
  // decision exists, and defaulting to "granted" would ship a tag to the very first paint.
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    const sync = () => setGranted(isGranted(category, readConsent()));
    sync();
    window.addEventListener(CONSENT_CHANGED_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CONSENT_CHANGED_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [category]);

  useEffect(() => {
    if (!granted) return;
    if (!src && !inline) return;
    if (document.getElementById(id)) return;

    const el = document.createElement('script');
    el.id = id;
    el.async = true;
    if (src) el.src = src;
    if (inline) el.textContent = inline;
    document.head.appendChild(el);

    // Withdrawal path. Runs on unmount AND whenever `granted` goes false, because the effect
    // re-runs on that dependency — which is exactly what makes "turn it off" mean something.
    return () => {
      document.getElementById(id)?.remove();
      for (const name of globals) {
        try {
          delete (window as unknown as Record<string, unknown>)[name];
        } catch {
          /* a non-configurable global; the tag is gone and its cookies are cleared below */
        }
      }
      if (category === MARKETING_CATEGORY_ID) purgeMarketingStorage();
    };
  }, [granted, id, src, inline, globals, category]);

  // Renders nothing. The tag is injected imperatively so that the "not yet granted" state has
  // no markup at all — not a disabled tag, not a commented one. Nothing.
  return null;
}
