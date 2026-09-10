'use client';

// The form a data subject uses to exercise their rights.
//
// GDPR Art. 12(2) requires the controller to *facilitate* the exercise of these rights. A
// privacy policy paragraph saying "contact us to exercise your rights" is not facilitation; it
// is a paragraph. This is the control that makes the sentence true.
//
// Two deliberate refusals in here:
//
//   1. It never says whether the address is known to us. Same response either way. A privacy
//      form that answers "we found your data" versus "we found nothing" is an account
//      enumeration oracle wearing a compliance hat.
//
//   2. It does not delete anything. Art. 12(6) permits the controller to seek confirmation of
//      identity before acting, and an endpoint that erased an account because a stranger typed
//      an address would be an account-deletion API for strangers. What this does is start a
//      documented statutory clock, which is exactly what it should do.
//
// Rendered visible from HTML with no entrance animation gating it (DEF-012): the form is the
// critical path, and a legal right that depends on an animation completing is not a right.

import { useState } from 'react';
import { ShieldCheck, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  privacyRequestCopy as copy,
  submitDataSubjectRequest,
  type DsarRequestType,
  type DsarRegime,
} from '@/lib/compliance/privacy-requests';

export function PrivacyRequestForm() {
  const [email, setEmail] = useState('');
  const [requestType, setRequestType] = useState<DsarRequestType>('access');
  const [regime, setRegime] = useState<DsarRegime>('gdpr');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const selectedRegime = copy.regimes.find((r) => r.value === regime);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await submitDataSubjectRequest({
        email,
        requestType,
        regime,
        message: message.trim() || undefined,
      });
      // Identical outcome whether or not the request was a duplicate. From the subject's side
      // both mean the same thing — it is on file and the clock is running — and distinguishing
      // them would leak whether a request already existed for that address.
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div
        className="rounded-lg border border-success/40 bg-success/5 p-6"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
          <div className="space-y-2">
            <h3 className="font-display text-lg font-semibold text-foreground">
              {copy.success.title}
            </h3>
            <p className="text-sm leading-relaxed text-muted-foreground">{copy.success.body}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate={false}>
      <div className="space-y-2">
        <label htmlFor="dsar-email" className="block text-sm font-semibold text-foreground">
          {copy.form.emailLabel}
        </label>
        <input
          id="dsar-email"
          type="email"
          required
          autoComplete="email"
          maxLength={320}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-describedby="dsar-email-help"
          className="w-full rounded-lg border-2 border-input bg-background px-3 py-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p id="dsar-email-help" className="text-xs text-muted-foreground">
          {copy.form.emailHelp}
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold text-foreground">{copy.form.typeLabel}</legend>
        <div className="space-y-2">
          {copy.requestTypes.map((type) => (
            <label
              key={type.value}
              className="flex cursor-pointer gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-accent/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            >
              <input
                type="radio"
                name="dsar-type"
                value={type.value}
                checked={requestType === type.value}
                onChange={() => setRequestType(type.value as DsarRequestType)}
                className="mt-1 h-4 w-4 shrink-0 accent-primary"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{type.label}</span>
                <span className="block text-xs text-muted-foreground">{type.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Shown only for erasure, because it is only true for erasure — and because a retention
          obligation the subject learns about *after* asking is a surprise, not a disclosure. */}
      {requestType === 'erasure' && (
        <div
          className="flex gap-3 rounded-lg border border-warning/40 bg-warning/5 p-4"
          role="note"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
          <p className="text-sm leading-relaxed text-foreground">{copy.erasureWarning}</p>
        </div>
      )}

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold text-foreground">
          {copy.form.regimeLabel}
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {copy.regimes.map((r) => (
            <label
              key={r.value}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-accent/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            >
              <input
                type="radio"
                name="dsar-regime"
                value={r.value}
                checked={regime === r.value}
                onChange={() => setRegime(r.value as DsarRegime)}
                className="mt-1 h-4 w-4 shrink-0 accent-primary"
              />
              <span className="text-sm font-medium text-foreground">{r.label}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{copy.form.regimeHelp}</p>
        {selectedRegime && (
          <p className="text-xs font-medium text-foreground">{selectedRegime.deadline}</p>
        )}
      </fieldset>

      <div className="space-y-2">
        <label htmlFor="dsar-message" className="block text-sm font-semibold text-foreground">
          {copy.form.messageLabel}
        </label>
        <textarea
          id="dsar-message"
          rows={4}
          maxLength={2000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={copy.form.messagePlaceholder}
          className="w-full rounded-lg border-2 border-input bg-background px-3 py-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {error && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" disabled={submitting} size="lg" className="w-full sm:w-auto">
        {submitting ? copy.form.submitting : copy.form.submit}
      </Button>

      <div className="space-y-2 border-t border-border pt-4">
        {[copy.notice.identity, copy.notice.noFee, copy.notice.complaint].map((line) => (
          <p key={line} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{line}</span>
          </p>
        ))}
      </div>
    </form>
  );
}
