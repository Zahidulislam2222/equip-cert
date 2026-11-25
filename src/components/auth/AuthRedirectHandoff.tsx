'use client';

import { useEffect } from 'react';

/**
 * Supabase sends the person to the project's SITE URL — this page — whenever the redirect the
 * app asked for is not on the project's allow list (the live list is reconciled by
 * scripts/auth-config.mjs; see supabase/auth-baseline.json). The confirmation tokens then arrive
 * in this page's URL fragment, and the person was left on the marketing page, signed in without
 * knowing it.
 *
 * Hand the fragment to the sign-in page, which reads the session and continues to the app. The
 * landing page itself does not load the Supabase client, and nothing is read from or logged
 * about the fragment here beyond recognising its shape.
 */
export function AuthRedirectHandoff() {
  useEffect(() => {
    const hash = window.location.hash;
    if (/^#(.*&)?access_token=/.test(hash) || /^#(.*&)?error_description=/.test(hash)) {
      window.location.replace(`/auth/login${hash}`);
    }
  }, []);
  return null;
}
