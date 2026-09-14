'use client';

/**
 * The hero: a WebGL inspection sequence you scroll through.
 *
 * This replaces two things that were failing:
 *
 * 1. A hero that was a **static poster image**. `ScrollScrubVideo` was mounted without a
 *    `src`, so the first thing anyone saw was a JPEG with a headline over it, permanently.
 * 2. A scroll-scrubbed **MP4** below it. A video hero has a failure mode that a page cannot
 *    hide: if the file is missing, slow, or the browser will not decode it, the section
 *    silently swaps itself for a still and a bullet list. That fallback is exactly what
 *    shipped and what everyone saw, because the film 404s on the deployed site.
 *
 * WebGL has no equivalent silent failure. It renders, or it takes the explicit fallback
 * below — there is no in-between state where the page looks finished but is dead.
 *
 * The copy for every beat is the film's copy, looked up by beat id from
 * `inspection-flight.json`. The camera stops live in the same file. There is exactly one
 * description of each inspection point in this project.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight, Box, Maximize2, RotateCcw, RotateCw } from 'lucide-react';

import flight from '@/content/inspection-flight.json';
import { Button } from '@/components/ui/button';
import { PLANS } from '@/lib/plans';
import { useIsMobile, usePrefersReducedMotion } from '@/hooks/use-media-query';
import type { SceneConfig, SceneHandle } from './inspection-scene';
import { InspectionRecord } from './InspectionRecord';

type ModelContent = Omit<SceneConfig, 'hotspots'> & {
  poster: string;
  posterMobile?: string;
  example: { badge: string; disclosure: string; equipment: string; serial: string; captured: string };
  hotspots: (SceneConfig['hotspots'][number] & {
    beat: string;
    read: { field: string; value: string; state: 'pass' | 'fail'; note: string };
  })[];
};

const MODEL = flight.model as unknown as ModelContent;
const SEQUENCE = MODEL.sequence;

type BeatLabel = { eyebrow: string; title: string; body: string };
const labelForBeat = (id: string | null): BeatLabel | null =>
  id ? ((flight.beats.find((b) => b.id === id)?.label as BeatLabel | null) ?? null) : null;

/** Every beat the sequence visits, in order, deduplicated — this is the reading order. */
const BEAT_IDS = Array.from(
  new Set(SEQUENCE.map((s) => s.beat).filter((b): b is string => Boolean(b)))
);

const ROTATE_STEP = Math.PI / 9;

/** Scroll length of the pinned hero. Each camera leg needs room to be read as a move
 *  rather than a cut; below roughly four viewports the beats run into each other. */
const HERO_VH = 520;

export function InspectionHero() {
  const isMobile = useIsMobile();
  const prefersReduced = usePrefersReducedMotion();

  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<SceneHandle | null>(null);
  const markerRefs = useRef(new Map<string, HTMLElement>());
  const rafRef = useRef<number | null>(null);

  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [activeBeat, setActiveBeat] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [exploded, setExploded] = useState(false);

  const cinematic = !isMobile && !prefersReduced && !failed;

  const registerMarker = useCallback((id: string, el: HTMLElement | null) => {
    if (el) markerRefs.current.set(id, el);
    else markerRefs.current.delete(id);
  }, []);

  useEffect(() => {
    if (!cinematic) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let handle: SceneHandle | null = null;

    import('./inspection-scene')
      .then(({ createScene }) =>
        createScene({
          canvas,
          config: MODEL,
          markers: markerRefs.current,
          reducedMotion: prefersReduced,
          onLoaded: () => !cancelled && setReady(true),
          onError: () => !cancelled && setFailed(true),
        })
      )
      .then((created) => {
        if (cancelled) {
          created?.dispose();
          return;
        }
        handle = created;
        handleRef.current = created;
      })
      .catch(() => !cancelled && setFailed(true));

    return () => {
      cancelled = true;
      handle?.dispose();
      handleRef.current = null;
      setReady(false);
    };
  }, [cinematic, prefersReduced]);

  // Scroll drives the camera. Progress goes to the scene every frame; React state changes
  // only when the BEAT changes, which is a handful of renders across the whole hero.
  useEffect(() => {
    if (!cinematic) return;
    const section = sectionRef.current;
    if (!section) return;

    const measure = () => {
      rafRef.current = null;
      const rect = section.getBoundingClientRect();
      const scrollable = rect.height - window.innerHeight;
      if (scrollable <= 0) return;
      const progress = Math.min(1, Math.max(0, -rect.top / scrollable));
      handleRef.current?.setProgress(progress);

      let next: string | null = null;
      for (const stop of SEQUENCE) if (progress >= stop.at) next = stop.beat;
      setActiveBeat((prev) => (prev === next ? prev : next));
    };
    // Cancel-and-reschedule rather than "skip if one is already pending".
    //
    // The skip-if-pending form coalesces identically, but it latches: it clears the handle
    // inside the callback, so if that callback is ever dropped or deferred — a backgrounded
    // tab, a throttled frame loop — the handle stays non-null and every subsequent scroll is
    // ignored for the life of the component. Observed exactly that while testing here, with
    // the camera frozen at its opening pose no matter how far the page was scrolled.
    // Cancelling first cannot wedge: there is always exactly one frame pending.
    const schedule = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
    };

    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [cinematic]);

  useEffect(() => {
    if (!cinematic) return;
    const section = sectionRef.current;
    if (!section) return;
    const observer = new IntersectionObserver(
      ([entry]) => handleRef.current?.setActive(entry.isIntersecting),
      { rootMargin: '200px' }
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, [cinematic]);

  const rotate = (dir: -1 | 1) => handleRef.current?.nudge(dir * ROTATE_STEP);
  const selectHotspot = (id: string) => {
    const next = selected === id ? null : id;
    setSelected(next);
    handleRef.current?.focus(next);
  };
  const toggleExploded = () => {
    const next = !exploded;
    setExploded(next);
    handleRef.current?.setExploded(next);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); rotate(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); rotate(1); }
  };

  const headline = (
    <>
      <p className="mb-6 flex items-center gap-2.5 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
        <span className="h-px w-8 bg-primary" />
        Equipment safety compliance
      </p>
      <h1 className="max-w-3xl font-display text-step-5 font-black">
        Equipment inspections
        <br />
        <span className="text-primary">that hold up.</span>
      </h1>
      <p className="mt-7 max-w-lg text-step-1 leading-relaxed text-muted-foreground">
        Identify equipment with AI, run the right checklist, capture GPS-tagged evidence,
        and produce an OSHA-ready report from a phone, with or without signal.
      </p>
      <div className="mt-9 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <Link href="/auth/signup">
          <Button size="lg" className="h-12 gap-2 px-7 text-[15px]">
            Start free <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
        <Link href="/app/dashboard">
          <Button variant="outline" size="lg" className="h-12 gap-2 px-7 text-[15px]">
            See the dashboard <ArrowUpRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>
      <p className="mt-6 text-sm text-muted-foreground">
        Free tier covers {PLANS.free.limits.inspectionsPerMonth} inspections a month. No card required.
      </p>
    </>
  );

  // ------------------------------------------------------------------ still + list
  // Phones, reduced motion, no WebGL, or a model that failed to load. A complete hero
  // with the whole inspection narrative as readable content — never a dead viewport.
  if (!cinematic) {
    return (
      <section id="hero" className="border-b border-border" aria-labelledby="hero-heading">
        <div className="relative overflow-hidden">
          <div className="bg-grid absolute inset-0" aria-hidden />
          <div
            aria-hidden
            className="absolute inset-y-0 right-0 w-1/2 bg-cover bg-center opacity-45 sm:opacity-70"
            style={{ backgroundImage: `url(${MODEL.posterMobile ?? MODEL.poster})` }}
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-transparent"
          />
          <div className="relative mx-auto max-w-6xl px-5 py-20" id="hero-heading-wrap">
            <div id="hero-heading">{headline}</div>
          </div>
        </div>

        <ol className="mx-auto max-w-6xl divide-y divide-border px-5">
          {BEAT_IDS.map((id, i) => {
            const beat = labelForBeat(id);
            const hotspot = MODEL.hotspots.find((h) => h.beat === id);
            if (!beat) return null;
            return (
              <li key={id} className="py-8">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
                  {beat.eyebrow || `Step ${String(i + 1).padStart(2, '0')}`}
                </p>
                <h2 className="mt-2.5 font-display text-step-1 font-bold">{beat.title}</h2>
                <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
                  {beat.body}
                </p>
                {hotspot ? (
                  <p className="mt-3 flex items-center gap-2.5 text-sm">
                    <span className="text-muted-foreground">{hotspot.read.field}:</span>
                    <span className="font-medium">{hotspot.read.value}</span>
                    <StateChip state={hotspot.read.state} />
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      </section>
    );
  }

  // ------------------------------------------------------------------ cinematic
  return (
    <section
      id="hero"
      ref={sectionRef}
      aria-labelledby="hero-heading"
      className="relative border-b border-border"
      style={{ height: `${HERO_VH}vh` }}
    >
      {/* Pinned BELOW the 64px sticky header, and sized to the space that leaves.
          `top-0 h-[100dvh]` overhung the viewport by exactly the header height until
          the page had scrolled past it, which cut the bottom off the record on the
          very first frame. */}
      <div className="sticky top-16 h-[calc(100dvh-4rem)] overflow-hidden">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />

        {/* The canvas is opaque now (it renders its own room), so the holding frame has to sit
            ON TOP of it rather than behind, or the visitor gets a black rectangle until the
            first WebGL frame lands. It fades out once the scene reports ready. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 bg-background transition-opacity duration-700"
          style={{ opacity: ready ? 0 : 1 }}
        >
          <div className="bg-grid absolute inset-0" />
          <div
            className="absolute inset-y-0 right-0 w-[58%] bg-contain bg-center bg-no-repeat opacity-75"
            style={{ backgroundImage: `url(${MODEL.poster})` }}
          />
        </div>
        <div aria-hidden className="flight-scrim absolute inset-0" />
        <div className="grain absolute inset-0" aria-hidden />

        <div
          className="relative z-20 mx-auto flex h-full max-w-6xl items-center px-5 pb-40"
          tabIndex={0}
          onKeyDown={onKeyDown}
          role="group"
          aria-label="Interactive 3-D fire extinguisher. Scroll to walk the inspection, or use the left and right arrow keys to rotate it."
        >
          <div className="w-full max-w-xl">
            {/* The H1 block is always in the document. It is only visually swapped for the
                beat copy as the camera arrives at each inspection point, so the page always
                has one real, findable heading. */}
            <div
              id="hero-heading"
              className="transition-all duration-500"
              style={{
                opacity: activeBeat ? 0 : 1,
                visibility: activeBeat ? 'hidden' : 'visible',
                position: activeBeat ? 'absolute' : 'static',
              }}
            >
              {headline}
            </div>

            <ol className="relative">
              {BEAT_IDS.map((id) => {
                const beat = labelForBeat(id);
                const on = activeBeat === id;
                if (!beat) return null;
                return (
                  <li
                    key={id}
                    className="transition-all duration-500"
                    style={{
                      opacity: on ? 1 : 0,
                      visibility: on ? 'visible' : 'hidden',
                      position: on ? 'static' : 'absolute',
                      inset: on ? undefined : 0,
                      transform: on ? 'translateY(0)' : 'translateY(0.75rem)',
                    }}
                  >
                    <p className="flex items-center gap-2.5 text-xs font-medium uppercase tracking-[0.2em] text-primary">
                      <span className="h-px w-8 bg-primary" />
                      {beat.eyebrow}
                    </p>
                    <h2 className="mt-5 font-display text-step-3 font-extrabold">{beat.title}</h2>
                    <p className="mt-5 max-w-md text-[15px] leading-relaxed text-muted-foreground">
                      {beat.body}
                    </p>

                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        {/* Hotspot markers, projected onto the moving geometry every frame.
            Only the scene's frame loop gives them a position, so until the model has loaded
            they sit unplaced at left-0 top-0 — all three stacked in the corner over the
            headline, on top of the holding frame. Hidden until the scene reports ready
            (DEF-065). `invisible` also keeps them out of the tab order meanwhile. */}
        {MODEL.hotspots.map((hotspot, i) => (
          <button
            key={hotspot.id}
            ref={(el) => registerMarker(hotspot.id, el)}
            type="button"
            onClick={() => selectHotspot(hotspot.id)}
            aria-pressed={selected === hotspot.id}
            className={`absolute left-0 top-0 z-20 flex h-9 w-9 items-center justify-center rounded-full border text-[13px] font-semibold tabular-nums transition-colors duration-300 ${ready ? '' : 'invisible'} ${
              selected === hotspot.id
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-primary/55 bg-background/85 text-primary hover:border-primary hover:bg-background'
            }`}
          >
            {String(i + 1).padStart(2, '0')}
            <span className="sr-only">
              {`. Inspect the ${labelForBeat(hotspot.beat)?.title ?? hotspot.read.field}.`}
            </span>
          </button>
        ))}

        <InspectionRecord activeBeat={activeBeat} />

        <div className="absolute bottom-36 right-5 z-20 flex flex-wrap gap-2">
          <ControlButton onClick={() => rotate(-1)} label="Rotate left">
            <RotateCcw className="h-4 w-4" strokeWidth={1.9} />
          </ControlButton>
          <ControlButton onClick={() => rotate(1)} label="Rotate right">
            <RotateCw className="h-4 w-4" strokeWidth={1.9} />
          </ControlButton>
          <ControlButton onClick={toggleExploded} label="Separate the parts" pressed={exploded}>
            {exploded ? <Box className="h-4 w-4" strokeWidth={1.9} /> : <Maximize2 className="h-4 w-4" strokeWidth={1.9} />}
            <span className="text-[13px] font-medium">{exploded ? 'Reassemble' : 'Separate parts'}</span>
          </ControlButton>
        </div>

      </div>
    </section>
  );
}

function StateChip({ state }: { state: 'pass' | 'fail' }) {
  const pass = state === 'pass';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
        pass
          ? 'border-success/40 bg-success/10 text-success'
          : 'border-destructive/45 bg-destructive/10 text-destructive'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${pass ? 'bg-success' : 'bg-destructive'}`} />
      {pass ? 'Pass' : 'Fail'}
    </span>
  );
}

function ControlButton({
  onClick,
  label,
  pressed,
  children,
}: {
  onClick: () => void;
  label: string;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border bg-card/85 px-3 py-1.5 text-muted-foreground backdrop-blur-sm transition-colors hover:border-primary/50 hover:text-foreground"
    >
      {children}
    </button>
  );
}
