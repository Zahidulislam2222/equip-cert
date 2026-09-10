'use client';

// Public route for exercising data subject rights.
//
// Deliberately its own URL rather than a section of the privacy policy. A regulator, a client's
// legal reviewer, and a data subject all need to be able to reach it directly, and "scroll to
// the bottom of the policy and find the paragraph" is not reachable. It is also linked from the
// policy and from the cookie banner, so there is no path where the right is documented but the
// control is not.
//
// Unauthenticated by design: the people most likely to file an erasure request are the ones who
// no longer have an account.

import Link from 'next/link';
import { ShieldCheck, ArrowLeft } from 'lucide-react';
import { config } from '@/lib/config';
import { PrivacyRequestForm } from '@/components/shared/PrivacyRequestForm';
import { privacyRequestCopy as copy } from '@/lib/compliance/privacy-requests';

export default function PrivacyRequestsPage() {
  const appName = config.app.name;

  return (
    <div className="min-h-dvh bg-background">
      <nav className="glass sticky top-0 z-50 border-b border-border">
        <div className="mx-auto flex h-16 max-w-3xl items-center px-4">
          <Link href="/" className="flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            <span className="font-display font-bold text-foreground">{appName}</span>
          </Link>
        </div>
      </nav>

      <main className="mx-auto max-w-3xl px-4 py-12">
        <Link
          href="/privacy"
          className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to the privacy policy
        </Link>

        <h1 className="mb-2 font-display text-3xl font-bold text-foreground">{copy.form.title}</h1>
        <p className="mb-8 leading-relaxed text-muted-foreground">{copy.form.intro}</p>

        <PrivacyRequestForm />
      </main>
    </div>
  );
}
