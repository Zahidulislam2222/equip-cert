'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  ArrowRight,
  Check,
  ChevronDown,
  ClipboardCheck,
  MapPin,
  ScanEye,
  ShieldCheck,
  Signature,
  WifiOff,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { InspectionHero } from '@/components/scroll/InspectionHero';
import { config } from '@/lib/config';
import { PLANS, PLAN_ORDER, formatPlanPrice } from '@/lib/plans';
import { useMagnetic, useTilt } from '@/hooks/use-pointer-motion';

/**
 * Capability claims, not performance statistics.
 *
 * Every line here is something the codebase actually does, so it survives the one question
 * a safety manager always asks: "measured how?" Invented conversion numbers do not.
 */
const capabilities = [
  {
    icon: WifiOff,
    label: 'Works with no signal',
    detail:
      'Inspections are written to device storage first and replayed to the server on reconnect. Plant rooms, basements and lift shafts do not stop the round, and nothing is retyped afterwards from memory.',
    span: 'wide' as const,
  },
  {
    icon: ScanEye,
    label: 'AI equipment identification',
    detail: 'Type, serial and visible defects from one photo.',
  },
  {
    icon: MapPin,
    label: 'GPS-tagged evidence',
    detail: 'Coordinates captured with the record, not typed in after.',
  },
  {
    icon: Signature,
    label: 'Immutable once signed',
    detail: 'Row-level policies block edits and deletes after signature.',
  },
];

/**
 * Presented as a spec sheet rather than a grid of glowing icon cards — it suits the subject
 * and it is the one layout generated marketing pages never reach for.
 */
const specs = [
  {
    title: 'Identify',
    body: 'Point the camera at any asset. The model returns equipment type, serial number and visible safety issues before the inspector has opened a form.',
    meta: 'Gemini, OpenAI or Anthropic. The provider is configuration, not code.',
  },
  {
    title: 'Check',
    body: 'The right checklist loads for the equipment in front of you, published from the CMS. No paper revision numbers, no wrong-form inspections.',
    meta: 'Contentful-backed, versioned centrally',
  },
  {
    title: 'Evidence',
    body: 'Photographs, GPS coordinates and a server-generated timestamp attach to the record as it is created, not reconstructed afterwards.',
    meta: 'Timestamps default to server now(), never the device clock',
  },
  {
    title: 'Sign',
    body: 'The inspector signs on the device. From that moment the record is immutable: row-level security refuses every update and delete.',
    meta: 'Enforced in the database, not in the client',
  },
  {
    title: 'Act',
    body: 'A failed line item opens a corrective action with an owner and a due date, and stays open until somebody closes it with evidence.',
    meta: 'Assignment, due dates, resolution tracking',
  },
  {
    title: 'Report',
    body: 'Export an OSHA-ready PDF carrying the equipment identity, inspector credentials, timestamps and the signature that closed it.',
    meta: 'Generated client-side; nothing to reconcile later',
  },
];

/**
 * Claims a technical buyer will interrogate, each with the mechanism behind it.
 *
 * The `evidence` line is the answer to "enforced where?" — the question that separates a
 * product that is actually safe from one that says it is. Every line describes something
 * this codebase does; none of it is aspirational.
 */
const evidence = [
  {
    claim: 'Signal is optional',
    summary:
      'Inspections are written to device storage first and replayed to the server on reconnect.',
    evidence:
      'The queue lives in IndexedDB on the device, so a round survives an app close, a dead battery or a week in a basement. Sync is replay, not merge: each queued inspection is submitted in the order it was taken, and a signed one can never be rewritten by a later sync.',
  },
  {
    claim: 'One company cannot see another',
    summary:
      'Every table carries an organization ID with policies enforced by the database.',
    evidence:
      'Row-level security is applied in PostgreSQL, so isolation does not depend on the client asking the right question. A bug in the front end, a crafted request, or a stolen anon key still cannot read another organization’s rows. The policy is evaluated on the server for every statement.',
  },
  {
    claim: 'Signed means signed',
    summary:
      'After signature, row-level policies refuse every update and delete.',
    evidence:
      'Immutability is a database policy rather than a disabled button. Timestamps default to the server’s own clock, so a device with the wrong date cannot backdate a record, and nobody (including an administrator using the app) can quietly amend an inspection after the fact.',
  },
];

const plans = PLAN_ORDER.map((id) => ({ ...PLANS[id], displayPrice: formatPlanPrice(id) }));

/**
 * The closing call to action, with a magnetic pull.
 *
 * The <a> itself never moves: the pull is applied to a span inside it, so the hit area stays
 * exactly where the pointer thinks it is. Reaching for a button that slides away is the
 * failure mode of nearly every implementation of this.
 */
function MagneticCTA({ href, children }: { href: string; children: React.ReactNode }) {
  const ref = useMagnetic<HTMLSpanElement>(0.26, 80);
  return (
    <Link href={href} className="mt-10 inline-block">
      <span ref={ref} className="inline-block will-change-transform">
        {children}
      </span>
    </Link>
  );
}

/** Disclosure card. Collapsed by default so the three claims stay scannable; the
 *  mechanism is one keypress away for the reader who wants it. */
function EvidenceCard({
  claim,
  summary,
  evidence: detail,
}: {
  claim: string;
  summary: string;
  evidence: string;
}) {
  const [open, setOpen] = useState(false);
  // Tilt is capped low and resets on exit, so the disclosure button underneath never moves
  // out from under the pointer.
  const tiltRef = useTilt<HTMLDivElement>(4.5, 5);
  return (
    <div
      ref={tiltRef}
      className="sc-rise flex flex-col bg-card p-7 transition-transform duration-200 ease-out will-change-transform"
    >
      <h3 className="font-display text-base font-bold">{claim}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{summary}</p>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="mt-4 inline-flex min-h-6 items-center gap-1.5 self-start text-xs font-medium uppercase tracking-wider text-primary transition-colors hover:text-foreground"
      >
        {open ? 'Hide' : 'Enforced where?'}
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
          strokeWidth={2.25}
        />
      </button>
      {open ? (
        <p className="mt-3 border-t border-border pt-3 text-sm leading-relaxed text-muted-foreground">
          {detail}
        </p>
      ) : null}
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-background">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        Skip to content
      </a>

      {/* Reading progress — native scroll timeline, zero JS. */}
      <div
        aria-hidden
        className="sc-progress fixed inset-x-0 top-0 z-[60] h-0.5 bg-primary"
      />

      {/* ================= NAV ================= */}
      <header className="glass sticky top-0 z-50 border-b border-border">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="gradient-primary flex h-8 w-8 items-center justify-center rounded-md">
              <ShieldCheck className="h-[18px] w-[18px] text-primary-foreground" />
            </span>
            <span className="font-display text-lg font-extrabold tracking-tight">
              {config.app.name}
            </span>
          </Link>

          <div className="hidden items-center gap-9 text-sm text-muted-foreground md:flex">
            <a href="#inspection" className="inline-flex min-h-6 items-center transition-colors hover:text-foreground">The inspection</a>
            <a href="#record" className="inline-flex min-h-6 items-center transition-colors hover:text-foreground">The record</a>
            <a href="#pricing" className="inline-flex min-h-6 items-center transition-colors hover:text-foreground">Pricing</a>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/auth/login">
              <Button variant="ghost" size="sm">Sign in</Button>
            </Link>
            <Link href="/auth/signup">
              <Button size="sm" className="gap-1.5">
                Start free <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </nav>
      </header>

      <main id="content">
      {/* ================= HERO =================
          A WebGL inspection sequence, not a poster and not a video.

          What was here before: a ScrollScrubVideo mounted WITHOUT a src, so the hero was a
          permanently static image; then a scroll-scrubbed MP4 below it which silently
          collapsed to a still whenever the file was slow, missing or undecodable. The
          deployed site 404s that file, so production was guaranteed to be static. WebGL
          either renders or takes the explicit still-plus-list fallback inside the
          component — there is no state where the page looks finished but is dead. */}
      <InspectionHero />



      {/* ================= CAPABILITIES (bento) =================
          Deliberate spans, not decorative ones. Offline-first is the claim this
          product is actually bought for, so it takes the wide tile and carries the
          longest explanation; the other three are equal-weight facts and are sized
          equally. DOM order is the reading order on every breakpoint. */}
      <section className="border-b border-border" aria-labelledby="capabilities-heading">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <h2 id="capabilities-heading" className="font-display text-step-3 font-extrabold">
              Built to survive the round.
            </h2>
            <p className="mt-5 text-[15px] leading-relaxed text-muted-foreground">
              A plant room has no signal, a technician has one hand free, and an auditor
              will read the result two years from now.
            </p>
          </div>
          <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {capabilities.map(({ icon: Icon, label, detail, span }) => (
              <div
                key={label}
                className={`sc-rise flex flex-col bg-card p-7 ${
                  span === 'wide' ? 'sm:col-span-2 lg:col-span-2' : ''
                }`}
              >
                <Icon className="h-5 w-5 text-primary" strokeWidth={1.75} />
                <h3
                  className={`mt-4 font-display font-bold ${
                    span === 'wide' ? 'text-step-2' : 'text-base'
                  }`}
                >
                  {label}
                </h3>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                  {detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ================= SPEC SHEET ================= */}
      <section id="record" className="mx-auto max-w-6xl px-5 py-28 lg:py-36">
        <div className="grid gap-14 lg:grid-cols-[minmax(0,24rem)_1fr] lg:gap-20">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <p className="mb-5 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              The record
            </p>
            {/* Two lines, wiped in on scroll. The text is not split into per-character
                spans — selection, search, translation and screen readers all stay intact. */}
            <h2 className="sc-reveal font-display text-step-3 font-extrabold">
              <span>From walk‑around</span>
              <span>to audit file.</span>
            </h2>
            <p className="mt-5 text-[15px] leading-relaxed text-muted-foreground">
              Every step writes to the same row, so the report reads what actually happened
              instead of summarising it afterwards.
            </p>
          </div>

          {/* Stacking cards. Each step pins and the next rides over it, leaving the
              previous number visible as a spine — the sequence stays legible as a
              sequence. Below 1024px and under reduced motion these are ordinary
              blocks in the same order, because that is what six ordered steps are. */}
          <ol className="space-y-5">
            {specs.map(({ title, body, meta }, index) => (
              <li
                key={title}
                className="stack-item"
                style={{ '--i': index } as React.CSSProperties}
              >
                <div className="rounded-lg border border-border bg-card p-7 shadow-card sm:p-9">
                  <div className="grid grid-cols-[1.5rem_1fr] gap-5 sm:gap-8">
                    {/* A hairline rule rather than a counter. Scroll-Craft names visible
                        `01 / 06` section numbers as a convergence tell and says delete them;
                        the stack already communicates sequence through overlap. */}
                    <span aria-hidden className="mt-3 h-px w-full bg-primary/60" />
                    <div>
                      <h3 className="font-display text-step-1 font-bold">{title}</h3>
                      <p className="mt-2.5 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
                        {body}
                      </p>
                      <p className="mt-4 border-t border-border pt-3.5 text-xs uppercase tracking-wider text-muted-foreground/65">
                        {meta}
                      </p>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ================= HOW IT HOLDS UP (expandable evidence) =================
          A technical buyer's first question is "enforced where?". Each claim opens to
          the actual mechanism. Disclosure is a real button with aria-expanded, never a
          hover — the detail has to be reachable by keyboard and on a touch screen. */}
      <section className="border-y border-border bg-card" aria-labelledby="evidence-heading">
        <div className="mx-auto max-w-6xl px-5 py-24">
          <h2 id="evidence-heading" className="mb-10 max-w-xl font-display text-step-3 font-extrabold">
            Every claim here is enforced somewhere you can check.
          </h2>
          <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
            {evidence.map((item) => (
              <EvidenceCard key={item.claim} {...item} />
            ))}
          </div>
        </div>
      </section>

      {/* ================= PRICING ================= */}
      <section id="pricing" className="mx-auto max-w-6xl px-5 py-28 lg:py-36">
        <div className="ml-auto max-w-2xl text-right">
          <h2 className="font-display text-step-3 font-extrabold">
            Start free. Pay when the team grows.
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-muted-foreground">
            Every plan carries the same evidence guarantees. The tiers differ in how many
            inspections and people they cover, nothing else.
          </p>
        </div>

        <div className="mt-14 grid gap-5 lg:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`sc-rise flex flex-col rounded-lg border p-7 ${
                plan.highlighted
                  ? 'border-primary bg-elevated shadow-card'
                  : 'border-border bg-card'
              }`}
            >
              <div className="flex items-baseline justify-between">
                <h3 className="font-display text-lg font-bold">{plan.name}</h3>
                {plan.highlighted ? (
                  <span className="rounded-full border border-primary/40 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-primary">
                    Most teams
                  </span>
                ) : null}
              </div>

              <p className="mt-2 text-sm text-muted-foreground">{plan.description}</p>

              <p className="mt-7 flex items-baseline gap-1.5">
                <span className="font-display text-step-3 font-black leading-none">
                  {plan.displayPrice}
                </span>
                <span className="text-sm text-muted-foreground">{plan.period}</span>
              </p>

              <ul className="mt-7 space-y-2.5 border-t border-border pt-7">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={2.5} />
                    <span className="text-muted-foreground">{feature}</span>
                  </li>
                ))}
              </ul>

              <Link href="/auth/signup" className="mt-8 block">
                <Button
                  className="w-full"
                  variant={plan.highlighted ? 'default' : 'outline'}
                >
                  {plan.cta}
                </Button>
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* ================= CTA (layered parallax) =================
          Three layers drifting at different rates from one scroll progress value.
          Only decoration moves — the heading, copy and button are stationary, so the
          depth costs nothing if the effect is dropped for reduced motion. */}
      <section className="relative overflow-hidden border-t border-border bg-card">
        <div className="parallax-layer sc-drift-slow bg-grid" aria-hidden />
        <div
          className="parallax-layer sc-drift-fast"
          aria-hidden
          style={{
            background:
              'radial-gradient(ellipse 55% 45% at 50% 40%, hsl(var(--primary) / 0.10), transparent 70%)',
          }}
        />
        <div className="grain absolute inset-0" aria-hidden />
        <div className="relative mx-auto max-w-3xl px-5 py-28 text-center lg:py-36">
          <ClipboardCheck className="mx-auto h-7 w-7 text-primary" strokeWidth={1.75} />
          <h2 className="sc-reveal mt-7 font-display text-step-4 font-black">
            <span>Your next audit is</span>
            <span>already being written.</span>
          </h2>
          <p className="mx-auto mt-6 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
            Every inspection your team runs today is either evidence you can produce or a gap
            you will have to explain. Start with the free tier and see the difference on the
            first walk-around.
          </p>
          <MagneticCTA href="/auth/signup">
            <Button size="lg" className="h-12 gap-2 px-8 text-[15px]">
              Start free <ArrowRight className="h-4 w-4" />
            </Button>
          </MagneticCTA>
        </div>
      </section>

      </main>

      {/* ================= FOOTER ================= */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-12 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <span className="gradient-primary flex h-7 w-7 items-center justify-center rounded-md">
              <ShieldCheck className="h-4 w-4 text-primary-foreground" />
            </span>
            <span className="font-display text-sm font-bold">{config.app.name}</span>
          </div>

          <nav className="flex flex-wrap items-center gap-x-7 gap-y-2 text-sm text-muted-foreground">
            <Link href="/privacy" className="inline-flex min-h-6 items-center transition-colors hover:text-foreground">Privacy</Link>
            <Link href="/terms" className="inline-flex min-h-6 items-center transition-colors hover:text-foreground">Terms</Link>
            <Link href="/auth/login" className="inline-flex min-h-6 items-center transition-colors hover:text-foreground">Sign in</Link>
          </nav>

          <p className="text-sm text-muted-foreground">
            &copy; {config.app.name}
          </p>
        </div>
      </footer>
    </div>
  );
}
