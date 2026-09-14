'use client';

// Terms of Service.
//
// The page is a renderer; every word lives in src/content/terms-of-service.json, the single
// owner of that copy (global Rule 12). It follows the privacy policy page exactly, so the two
// legal documents look and behave the same.
//
// The page this replaced was hand-written JSX that rendered `new Date()` as "Last updated" and
// cited the wrong federal standard with a retention period five times too long. The corrections
// are recorded in the JSON file's $comment.

import Link from 'next/link';
import { ShieldCheck, ArrowRight } from 'lucide-react';
import { config } from '@/lib/config';
import terms from '@/content/terms-of-service.json';

export default function TermsPage() {
  const appName = config.app.name;

  return (
    <div className="min-h-dvh bg-background">
      <nav className="glass sticky top-0 z-50 border-b border-border">
        <div className="mx-auto flex h-16 max-w-4xl items-center px-4">
          <Link href="/" className="flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            <span className="font-display font-bold text-foreground">{appName}</span>
          </Link>
        </div>
      </nav>

      <main className="mx-auto max-w-4xl px-4 py-12">
        <h1 className="mb-2 font-display text-3xl font-bold text-foreground">Terms of Service</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Version {terms.documentVersion} · in effect from {terms.effectiveDate}
        </p>

        <p className="mb-8 leading-relaxed text-foreground">{terms.intro}</p>

        <div className="mb-10 rounded-lg border border-border bg-card p-5">
          <h2 className="mb-3 font-display text-base font-semibold text-foreground">Provider</h2>
          <dl className="space-y-2 text-sm">
            {[
              ['Provider', terms.provider.legalName],
              ['Address', terms.provider.address],
              ['Contact', terms.provider.email],
              ['Governing law', terms.provider.governingLaw],
            ].map(([label, value]) => (
              <div key={label} className="sm:flex sm:gap-3">
                <dt className="shrink-0 font-medium text-foreground sm:w-48">{label}</dt>
                <dd className="text-muted-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="space-y-10 text-foreground">
          {terms.sections.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-20">
              <h2 className="mb-3 font-display text-xl font-semibold">{section.heading}</h2>

              {section.paragraphs.map((p) => (
                <p key={p.slice(0, 48)} className="mb-3 leading-relaxed text-muted-foreground">
                  {p}
                </p>
              ))}

              {'list' in section && section.list && (
                <ul className="list-disc space-y-2 pl-6 leading-relaxed text-muted-foreground">
                  {section.list.map((item) => (
                    <li key={item.slice(0, 48)}>{item}</li>
                  ))}
                </ul>
              )}

              {'notes' in section && section.notes && (
                <ul className="mt-3 space-y-2 border-l-2 border-border pl-4">
                  {section.notes.map((note) => (
                    <li key={note.slice(0, 48)} className="text-sm leading-relaxed text-muted-foreground">
                      {note}
                    </li>
                  ))}
                </ul>
              )}

              {'cta' in section && section.cta && (
                <Link
                  href={section.cta.href}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-md transition-all hover:bg-primary/90 hover:shadow-lg"
                >
                  {section.cta.label}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              )}
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
