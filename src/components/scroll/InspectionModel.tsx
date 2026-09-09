'use client';

/**
 * "Inspect it yourself" — the interactive counterpart to the rendered film.
 *
 * The film narrates a fixed camera pass. This section hands the camera over: drag the
 * extinguisher, take it apart, or open one of the three inspection points and read what a
 * vision model returns for it. A film cannot do that, which is the only good reason to pay
 * for a 3D runtime on a marketing page.
 *
 * What is deliberate here:
 *
 * **Every capability is a real control.** The hotspots are `<button>`s in the document, in
 * reading order, reachable by Tab, with visible focus. Rotation has arrow keys and two
 * buttons, not only a pointer drag. Nothing here is hover-only or pointer-only.
 *
 * **The example is labelled as an example.** The identification panel shows what the model
 * returns for an inspection point. It is written by hand, so it says so — on a compliance
 * product, a fabricated model response presented as a live one is the kind of thing that
 * ends a sales conversation.
 *
 * **Desktop web only, by design.** Phones and reduced-motion visitors get the still and the
 * same three inspection points as ordinary readable content. Shipping a WebGL canvas and a
 * 444 KB model to a technician on plant-room data would be hostile, and three.js is
 * dynamically imported so it is never in their bundle either.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Maximize2, RotateCcw, RotateCw, Sparkles } from 'lucide-react';

import flight from '@/content/inspection-flight.json';
import { useIsMobile, usePrefersReducedMotion } from '@/hooks/use-media-query';
import type { SceneConfig, SceneHandle } from './inspection-scene';

/**
 * The manifest's hotspots carry both the scene's geometry fields and this component's copy
 * fields. `Omit` rather than an intersection: intersecting two types that each declare
 * `hotspots` yields `A[] & B[]`, which TypeScript will not read properties off cleanly.
 */
type ModelContent = Omit<SceneConfig, 'hotspots'> & {
  poster: string;
  example: {
    badge: string;
    disclosure: string;
    equipment: string;
    serial: string;
    captured: string;
  };
  hotspots: (SceneConfig['hotspots'][number] & {
    beat: string;
    read: { field: string; value: string; state: 'pass' | 'fail'; note: string };
  })[];
};

const MODEL = flight.model as unknown as ModelContent;

type BeatLabel = { eyebrow: string; title: string; body: string };

/** Hotspot copy is not written here. It is the film's copy, looked up by beat id. */
function labelForBeat(beatId: string): BeatLabel | null {
  const beat = flight.beats.find((b) => b.id === beatId);
  return (beat?.label as BeatLabel | null) ?? null;
}

/** Keyboard and button rotation step, in radians. One press should read as a deliberate
 *  turn rather than a nudge, without spinning past the part you were looking at. */
const ROTATE_STEP = Math.PI / 9;

export function InspectionModel() {
  const isMobile = useIsMobile();
  const prefersReduced = usePrefersReducedMotion();

  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<SceneHandle | null>(null);
  const markerRefs = useRef(new Map<string, HTMLElement>());
  const rafRef = useRef<number | null>(null);

  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [exploded, setExploded] = useState(false);

  // Reduced motion takes the still, exactly as the film does. An interactive canvas is
  // visitor-driven rather than autoplaying, but the idle float, the eased camera and the
  // scroll-linked spin are all unrequested movement, and stripping them leaves an
  // expensive canvas doing less than the still does.
  const interactive = !isMobile && !prefersReduced && !failed;

  const registerMarker = useCallback((id: string, element: HTMLElement | null) => {
    if (element) markerRefs.current.set(id, element);
    else markerRefs.current.delete(id);
  }, []);

  // ------------------------------------------------------------------ scene lifecycle
  useEffect(() => {
    if (!interactive) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let handle: SceneHandle | null = null;

    // Dynamic import: three.js and the loader live in their own chunk, so a visitor who
    // never scrolls this far never downloads them.
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
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      handle?.dispose();
      handleRef.current = null;
      setReady(false);
    };
  }, [interactive, prefersReduced]);

  // ------------------------------------------------------------------ scroll -> rotation
  useEffect(() => {
    if (!interactive) return;
    const section = sectionRef.current;
    if (!section) return;

    const measure = () => {
      rafRef.current = null;
      const rect = section.getBoundingClientRect();
      const scrollable = rect.height - window.innerHeight;
      if (scrollable <= 0) return;
      const progress = Math.min(1, Math.max(0, -rect.top / scrollable));
      handleRef.current?.setProgress(progress);
    };
    const schedule = () => {
      // Cancel-and-reschedule, never skip-if-pending: the skip form latches forever
      // if a single rAF callback is dropped, freezing the scroll effect permanently.
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
  }, [interactive]);

  // ------------------------------------------------------------------ pause when off-screen
  useEffect(() => {
    if (!interactive) return;
    const section = sectionRef.current;
    if (!section) return;
    const observer = new IntersectionObserver(
      ([entry]) => handleRef.current?.setActive(entry.isIntersecting),
      { rootMargin: '200px' }
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, [interactive]);

  // ------------------------------------------------------------------ controls
  const selectHotspot = (id: string) => {
    const next = selected === id ? null : id;
    setSelected(next);
    handleRef.current?.focus(next);
  };

  const rotate = (direction: -1 | 1) => handleRef.current?.nudge(direction * ROTATE_STEP);

  const reset = () => {
    setSelected(null);
    setExploded(false);
    handleRef.current?.reset();
  };

  const toggleExploded = () => {
    const next = !exploded;
    setExploded(next);
    handleRef.current?.setExploded(next);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      rotate(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      rotate(1);
    }
  };

  const active = MODEL.hotspots.find((h) => h.id === selected) ?? null;
  const activeLabel = active ? labelForBeat(active.beat) : null;

  // ------------------------------------------------------------------ still + list
  if (!interactive) {
    return (
      <section id="inspect" className="border-b border-border" aria-labelledby="inspect-heading">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <p className="mb-5 flex items-center gap-2.5 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            <span className="h-px w-8 bg-primary" />
            Inspection points
          </p>
          <h2 id="inspect-heading" className="font-display text-step-3 font-extrabold">
            What the model reads,
            <br />
            point by point.
          </h2>
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            {MODEL.example.badge}: {MODEL.example.disclosure}
          </p>

          <dl className="mt-12 divide-y divide-border border-y border-border">
            {MODEL.hotspots.map((hotspot) => {
              const label = labelForBeat(hotspot.beat);
              return (
                <div key={hotspot.id} className="grid gap-2 py-7 sm:grid-cols-[14rem_1fr] sm:gap-8">
                  <dt className="font-display text-base font-bold">
                    {label?.title ?? hotspot.read.field}
                  </dt>
                  <dd>
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <span className="font-display text-step-1 font-bold">{hotspot.read.value}</span>
                      <StateChip state={hotspot.read.state} />
                    </p>
                    <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
                      {label?.body ?? hotspot.read.note}
                    </p>
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      </section>
    );
  }

  // ------------------------------------------------------------------ interactive
  return (
    <section
      id="inspect"
      ref={sectionRef}
      aria-labelledby="inspect-heading"
      className="relative border-b border-border"
      style={{ height: '240vh' }}
    >
      <div className="sticky top-0 h-[100dvh] overflow-hidden">
        <div className="bg-grid absolute inset-0" aria-hidden />

        <div className="relative mx-auto grid h-full max-w-6xl items-center gap-8 px-5 lg:grid-cols-[minmax(0,26rem)_1fr]">
          {/* ---------------------------------------------------- copy + example panel */}
          <div className="order-2 lg:order-1">
            <p className="mb-5 flex items-center gap-2.5 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              <span className="h-px w-8 bg-primary" />
              Inspect it yourself
            </p>
            <h2 id="inspect-heading" className="font-display text-step-3 font-extrabold">
              {activeLabel ? activeLabel.title : 'Turn it. Open it. Check it.'}
            </h2>

            <div
              className="mt-6 rounded-lg border border-border bg-card/85 p-5 backdrop-blur-sm"
              aria-live="polite"
            >
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                <Sparkles className="h-3.5 w-3.5" strokeWidth={2.25} />
                {MODEL.example.badge}
              </p>

              <dl className="mt-4 space-y-2.5 border-b border-border pb-4 text-sm">
                <Row term="Equipment" value={MODEL.example.equipment} />
                <Row term="Serial" value={MODEL.example.serial} />
                <Row term="Captured from" value={MODEL.example.captured} />
              </dl>

              {/* All three readings are in the document at all times.
                  The canvas is the presentation; this list is the truth. With JavaScript
                  off, with the model failed, or with a screen reader, a visitor still gets
                  every inspection point and its result — selecting one only expands its
                  explanation and flies the camera to it. This is the same rule the film
                  follows, and the reason DEF-012 cannot happen here. */}
              <ol className="divide-y divide-border">
                {MODEL.hotspots.map((hotspot, index) => {
                  const isActive = selected === hotspot.id;
                  const label = labelForBeat(hotspot.beat);
                  return (
                    <li key={hotspot.id}>
                      <button
                        type="button"
                        onClick={() => selectHotspot(hotspot.id)}
                        aria-expanded={isActive}
                        className="flex w-full items-baseline justify-between gap-3 py-3 text-left transition-colors hover:text-foreground"
                      >
                        <span className="flex items-baseline gap-2.5">
                          <span className="text-[11px] tabular-nums text-muted-foreground/70">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          <span className={isActive ? 'font-medium' : 'text-muted-foreground'}>
                            {hotspot.read.field}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2.5">
                          <span className="text-sm font-medium">{hotspot.read.value}</span>
                          <StateChip state={hotspot.read.state} />
                        </span>
                      </button>
                      {isActive ? (
                        <p className="pb-4 text-sm leading-relaxed text-muted-foreground">
                          {label?.body ?? hotspot.read.note}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ol>

              <p className="mt-4 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground/75">
                {MODEL.example.disclosure}
              </p>
            </div>

            {/* Controls are real buttons so nothing here is pointer-only. */}
            <div className="mt-5 flex flex-wrap gap-2">
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
              <ControlButton onClick={reset} label="Reset the view">
                <span className="text-[13px] font-medium">Reset</span>
              </ControlButton>
            </div>
          </div>

          {/* ---------------------------------------------------- canvas + hotspots */}
          <div className="order-1 h-[46vh] lg:order-2 lg:h-[76vh]">
            <div
              className="relative h-full w-full"
              tabIndex={0}
              onKeyDown={onKeyDown}
              role="group"
              aria-label="Interactive 3-D model of a fire extinguisher. Use the left and right arrow keys to rotate it."
            >
              {/* A real frame of the same object, held until the first WebGL frame paints,
                  so the column is never an empty rectangle. */}
              <div
                aria-hidden
                className="absolute inset-0 bg-contain bg-center bg-no-repeat transition-opacity duration-700"
                style={{ backgroundImage: `url(${MODEL.poster})`, opacity: ready ? 0 : 0.9 }}
              />
              <canvas ref={canvasRef} className="h-full w-full" aria-hidden />

              {MODEL.hotspots.map((hotspot, index) => (
                <button
                  key={hotspot.id}
                  ref={(el) => registerMarker(hotspot.id, el)}
                  type="button"
                  onClick={() => selectHotspot(hotspot.id)}
                  aria-pressed={selected === hotspot.id}
                  className={`absolute left-0 top-0 flex h-9 w-9 items-center justify-center rounded-full border text-[13px] font-semibold tabular-nums transition-colors duration-300 ${
                    selected === hotspot.id
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-primary/55 bg-background/85 text-primary hover:border-primary hover:bg-background'
                  }`}
                >
                  {String(index + 1).padStart(2, '0')}
                  <span className="sr-only">
                    {` — inspection point: ${labelForBeat(hotspot.beat)?.title ?? hotspot.read.field}`}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

/** Pass and fail are the two colours this product is not allowed to spend on decoration,
 *  so they appear here and carry a word as well as a hue. */
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
      className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
    >
      {children}
    </button>
  );
}
