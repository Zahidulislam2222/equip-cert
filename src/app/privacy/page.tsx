'use client';

// Privacy policy.
//
// The page is a renderer; every word lives in src/content/privacy-policy.json, which is the
// single owner of that copy (global Rule 12). The version date is a value in that file, edited
// by hand when the wording changes.
//
// The page this replaced rendered `new Date()` into "Last updated", so the policy claimed to
// have been revised on whatever day you happened to open it. That is not a cosmetic bug: the
// only thing a version date does is let someone establish what a data subject was told and
// when, and a date generated at read time cannot establish anything. The stored consent record
// is keyed to this same version, so the two cannot drift apart.

import Link from 'next/link';
import { ShieldCheck, ArrowRight } from 'lucide-react';
import { config } from '@/lib/config';
import policy from '@/content/privacy-policy.json';

function SectionTable({
  table,
}: {
  table: { columns: string[]; rows: string[][] };
}) {
  return (
    // Tables are the one thing allowed to scroll sideways on a narrow screen; the page body
    // must not. A three-column legal-basis table cannot usefully be reflowed to 380px.
    <div className="my-4 overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
        <thead>
          <tr className="bg-muted/50">
            {table.columns.map((col) => (
              <th key={col} className="border-b border-border px-3 py-2 font-semibold text-foreground">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row[0]} className="align-top">
              {row.map((cell, i) => (
                <td
                  key={i}
                  className={`border-b border-border px-3 py-2 leading-relaxed ${
                    i === 0 ? 'font-medium text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PrivacyPolicyPage() {
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
        <h1 className="mb-2 font-display text-3xl font-bold text-foreground">Privacy Policy</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Version {policy.documentVersion} · in effect from {policy.effectiveDate}
        </p>

        <p className="mb-8 leading-relaxed text-foreground">{policy.intro}</p>

        <div className="mb-10 rounded-lg border border-border bg-card p-5">
          <h2 className="mb-3 font-display text-base font-semibold text-foreground">
            Controller and contact
          </h2>
          <dl className="space-y-2 text-sm">
            {[
              ['Controller', policy.controller.legalName],
              ['Address', policy.controller.address],
              ['Privacy contact', policy.controller.email],
              ['EU representative', policy.controller.euRepresentative],
              ['Data Protection Officer', policy.controller.dpo],
            ].map(([label, value]) => (
              <div key={label} className="sm:flex sm:gap-3">
                <dt className="shrink-0 font-medium text-foreground sm:w-48">{label}</dt>
                <dd className="text-muted-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="space-y-10 text-foreground">
          {policy.sections.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-20">
              <h2 className="mb-3 font-display text-xl font-semibold">{section.heading}</h2>

              {section.paragraphs.map((p) => (
                <p key={p.slice(0, 48)} className="mb-3 leading-relaxed text-muted-foreground">
                  {p}
                </p>
              ))}

              {'table' in section && section.table && <SectionTable table={section.table} />}

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
