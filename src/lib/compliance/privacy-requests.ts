// Data subject request submission — the client half.
//
// Every string a data subject reads comes from src/content/privacy-requests.json, which is the
// single owner of that copy (global Rule 12). Nothing here restates it, and nothing here
// decides a deadline: the statutory clock is computed by the database on insert, because a
// deadline calculated in a browser is a deadline the browser's clock can be wrong about.

import copy from '@/content/privacy-requests.json';
import { config } from '@/lib/config';
import { supabase } from '@/lib/supabase';

export const privacyRequestCopy = copy;

export type DsarRequestType = (typeof copy.requestTypes)[number]['value'];
export type DsarRegime = (typeof copy.regimes)[number]['value'];

export interface DsarSubmission {
  email: string;
  requestType: DsarRequestType;
  regime: DsarRegime;
  message?: string;
}

export interface DsarResult {
  /** True when the request is on file. `duplicate` means it already was. */
  received: boolean;
  duplicate: boolean;
}

/**
 * File a request.
 *
 * The access token is attached when the caller happens to be signed in, purely so the server
 * can link the request to their account and tenant. It is never required — the whole point is
 * that someone who has already deleted their account, or never had one, can still file.
 *
 * Errors are surfaced, not swallowed. A privacy form that fails silently tells the subject a
 * statutory clock is running when it is not, which is worse than telling them to email us.
 */
export async function submitDataSubjectRequest(input: DsarSubmission): Promise<DsarResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) {
      headers.Authorization = `Bearer ${data.session.access_token}`;
    }
  } catch {
    // No session, or storage is unavailable. Filing anonymously is the supported path, so
    // this is not an error condition — it is the common one.
  }

  const res = await fetch(`${config.app.url}/api/dsar`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email: input.email,
      requestType: input.requestType,
      regime: input.regime,
      ...(input.message ? { message: input.message } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Request failed (${res.status})`);
  }

  return (await res.json()) as DsarResult;
}
