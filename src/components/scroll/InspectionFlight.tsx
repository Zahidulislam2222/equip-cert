'use client';

/**
 * The hero: a scroll-scrubbed inspection film with HTML labels pinned to its beats.
 *
 * Two ideas hold this together.
 *
 * **The list is the truth; the film is the presentation.** Every beat's copy is in the DOM
 * as a semantic ordered list, always, in reading order. Sighted desktop visitors see one
 * beat at a time over the film; screen readers, keyboard users, `prefers-reduced-motion`
 * users, phones and anyone whose video fails read the same list as ordinary content. Nothing
 * is gated behind the animation (see DEF-012 — a lesson this project already paid for).
 *
 * **Labels never live inside the video.** Generated or rendered footage cannot be trusted to
 * carry readable text, and baked-in text cannot be translated, selected, zoomed or read
 * aloud. The camera is authored in `src/content/inspection-flight.json`, which this component
 * and the Blender script both read, so a label cannot drift off the part it names.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import flight from '@/content/inspection-flight.json';

type Beat = {
  id: string;
  startFrame: number;
  endFrame: number;
  label: { eyebrow: string; title: string; body: string } | null;
};

const BEATS = flight.beats as Beat[];
const TOTAL_FRAMES = flight.frames;

/** Scroll distance per beat, in viewport heights. Dwell beats get room to be read. */
const VH_PER_BEAT = 1.15;

const MOBILE_QUERY = '(max-width: 860px), (hover: none) and (pointer: coarse)';
const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(query: string) {
  return (onChange: () => void) => {
    const mq = window.matchMedia(query);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  };
}
const snapshot = (query: string) => () => window.matchMedia(query).matches;
const serverSnapshot = () => false;

const subscribeMobile = subscribe(MOBILE_QUERY);
const subscribeReduced = subscribe(REDUCED_QUERY);
const mobileSnapshot = snapshot(MOBILE_QUERY);
const reducedSnapshot = snapshot(REDUCED_QUERY);

type Props = {
  /** Desktop film. Omit and the component renders the poster-and-list composition. */
  src?: string;
  poster: string;
  posterMobile?: string;
};

export function InspectionFlight({ src, poster, posterMobile }: Props) {
  const sectionRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const seekingRef = useRef(false);
  const targetRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const [activeIndex, setActiveIndex] = useState(0);
  const [painted, setPainted] = useState(false);
  const [failed, setFailed] = useState(false);

  const isMobile = useSyncExternalStore(subscribeMobile, mobileSnapshot, serverSnapshot);
  const prefersReduced = useSyncExternalStore(subscribeReduced, reducedSnapshot, serverSnapshot);

  // A phone gets the still-plus-list composition by design, not as a downgrade: the film is
  // tens of megabytes and scrubbing it over mobile data is hostile. Recorded in the manifest.
  const cinematic = Boolean(src) && !failed && !isMobile && !prefersReduced;
  const posterSrc = isMobile && posterMobile ? posterMobile : poster;

  /** Frame boundaries as scroll progress, so a beat's dwell is where its label is readable. */
  const boundaries = useMemo(
    () => BEATS.map((b) => ({
      id: b.id,
      start: (b.startFrame - 1) / (TOTAL_FRAMES - 1),
      end: (b.endFrame - 1) / (TOTAL_FRAMES - 1),
    })),
    []
  );

  useEffect(() => {
    const section = sectionRef.current;
    const video = videoRef.current;
    if (!cinematic || !section || !video) return;

    const onSeeking = () => { seekingRef.current = true; };
    const onLoaded = () => setPainted(true);
    const onSeeked = () => {
      seekingRef.current = false;
      setPainted(true);
      apply();
    };

    function apply() {
      const el = videoRef.current;
      if (!el || seekingRef.current || !el.duration || Number.isNaN(el.duration)) return;
      const next = targetRef.current * el.duration;
      if (Math.abs(next - el.currentTime) < 1 / 60) return;
      el.currentTime = next;
    }

    const measure = () => {
      rafRef.current = null;
      const rect = section.getBoundingClientRect();
      const scrollable = rect.height - window.innerHeight;
      if (scrollable <= 0) return;
      const progress = Math.min(1, Math.max(0, -rect.top / scrollable));
      targetRef.current = progress;
      apply();

      // State changes only when the beat changes — a handful of renders across the whole
      // scroll rather than one per frame.
      let next = 0;
      for (let i = 0; i < boundaries.length; i += 1) {
        if (progress >= boundaries[i].start) next = i;
      }
      setActiveIndex((prev) => (prev === next ? prev : next));
    };

    const schedule = () => {
      // Cancel-and-reschedule, never skip-if-pending: the skip form latches forever
      // if a single rAF callback is dropped, freezing the scroll effect permanently.
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
    };

    video.addEventListener('seeking', onSeeking);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('loadeddata', onLoaded);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    schedule();

    return () => {
      video.removeEventListener('seeking', onSeeking);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('loadeddata', onLoaded);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [cinematic, boundaries]);

  // A stalled or missing film must not leave five viewport-heights of dead scroll behind a
  // static poster. `error` is not enough on its own: a 404 that returns an HTML body, a
  // stalled CDN, or an expired URL can all leave the element quietly in a loading state
  // forever. If no usable duration has arrived in time, fall back to the still-plus-list
  // composition, which is a complete experience rather than a broken one.
  useEffect(() => {
    if (!cinematic) return;
    const LOAD_BUDGET_MS = 8000;
    const timer = window.setTimeout(() => {
      const el = videoRef.current;
      const usable = el && el.duration > 0 && !Number.isNaN(el.duration);
      if (!usable) setFailed(true);
    }, LOAD_BUDGET_MS);

    const el = videoRef.current;
    const onStalled = () => {
      // NETWORK_NO_SOURCE — the browser has given up finding a playable resource.
      if (el && el.networkState === 3) setFailed(true);
    };
    el?.addEventListener('stalled', onStalled);
    el?.addEventListener('emptied', onStalled);

    return () => {
      window.clearTimeout(timer);
      el?.removeEventListener('stalled', onStalled);
      el?.removeEventListener('emptied', onStalled);
    };
  }, [cinematic]);

  // iOS refuses to decode a frame until the element has played once under a user gesture.
  useEffect(() => {
    if (!cinematic) return;
    const prime = () => {
      const el = videoRef.current;
      if (!el) return;
      el.play().then(() => el.pause()).catch(() => {
        /* Refusal is fine — the poster is already showing a real frame. */
      });
    };
    window.addEventListener('touchstart', prime, { once: true, passive: true });
    return () => window.removeEventListener('touchstart', prime);
  }, [cinematic]);

  const labelled = BEATS.filter((b) => b.label);

  // ---------------------------------------------------------------- still + list
  if (!cinematic) {
    return (
      <section id="inspection" className="border-b border-border" aria-labelledby="flight-heading">
        <div className="relative h-[62vh] min-h-[380px] overflow-hidden">
          {/* Deliberately a plain <img>. next.config.ts sets output:"export" with
              images.unoptimized:true for the Capacitor build, so next/image performs no
              optimization here — it would only add client JS around the same <img>. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={posterSrc}
            alt="A fire extinguisher lit for inspection, showing the pressure gauge, lever and hose."
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-background via-background/55 to-background/10" />
          <div className="relative mx-auto flex h-full max-w-6xl flex-col justify-end px-5 pb-9">
            <p className="mb-4 flex items-center gap-2.5 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              <span className="h-px w-8 bg-primary" />
              The inspection
            </p>
            <h2 id="flight-heading" className="font-display text-step-3 font-extrabold">
              Three checks, one signed record.
            </h2>
          </div>
        </div>

        <ol className="mx-auto max-w-6xl divide-y divide-border px-5">
          {labelled.map((beat) => (
            <li key={beat.id} className="py-8">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
                {beat.label!.eyebrow}
              </p>
              <h3 className="mt-2.5 font-display text-step-1 font-bold">{beat.label!.title}</h3>
              <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
                {beat.label!.body}
              </p>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  // ---------------------------------------------------------------- scrubbed film
  return (
    <section
      id="inspection"
      ref={sectionRef}
      aria-labelledby="flight-heading"
      className="relative border-b border-border"
      style={{ height: `${BEATS.length * VH_PER_BEAT * 100}vh` }}
    >
      <div className="sticky top-0 h-[100dvh] w-full overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 bg-cover bg-center transition-opacity duration-500"
          style={{ backgroundImage: `url(${posterSrc})`, opacity: painted ? 0 : 1 }}
        />
        <video
          ref={videoRef}
          src={src}
          poster={posterSrc}
          preload="auto"
          muted
          playsInline
          disablePictureInPicture
          aria-hidden
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />

        {/* Scrim over the copy column only; the subject is composed right of frame. */}
        {/* Scrim strength is defined once in globals.css (.flight-scrim) and is
            verified against the actual film by scripts/check-overlay-contrast.py. */}
        <div aria-hidden className="flight-scrim absolute inset-0" />

        <h2 id="flight-heading" className="sr-only">
          The inspection, step by step
        </h2>

        <div className="relative mx-auto flex h-full max-w-6xl items-center px-5">
          <ol className="relative w-full max-w-md">
            {BEATS.map((beat, i) => (
              <li
                key={beat.id}
                // Inactive beats stay in the accessibility tree and in reading order; only
                // their presentation is suppressed. `visibility` also removes them from the
                // tab order, so hidden copy cannot steal focus.
                className="transition-all duration-500 [&:not(:first-child)]:absolute [&:not(:first-child)]:inset-0"
                style={{
                  opacity: i === activeIndex ? 1 : 0,
                  visibility: i === activeIndex ? 'visible' : 'hidden',
                  transform: i === activeIndex ? 'translateY(0)' : 'translateY(0.75rem)',
                }}
              >
                {beat.label ? (
                  <>
                    <p className="flex items-center gap-2.5 text-xs font-medium uppercase tracking-[0.2em] text-primary">
                      <span className="h-px w-8 bg-primary" />
                      {beat.label.eyebrow}
                    </p>
                    <h3 className="mt-5 font-display text-step-3 font-extrabold">
                      {beat.label.title}
                    </h3>
                    <p className="mt-5 text-[15px] leading-relaxed text-muted-foreground">
                      {beat.label.body}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="flex items-center gap-2.5 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                      <span className="h-px w-8 bg-primary" />
                      The inspection
                    </p>
                    <h3 className="mt-5 font-display text-step-3 font-extrabold">
                      Three checks,
                      <br />
                      one signed record.
                    </h3>
                    <p className="mt-5 text-[15px] leading-relaxed text-muted-foreground">
                      Scroll to walk the inspection. Every step writes to the same record.
                    </p>
                  </>
                )}
              </li>
            ))}
          </ol>
        </div>

        {/* Beat progress — orientation while scrubbing, and a target-size-safe list marker. */}
        <ul
          aria-hidden
          className="absolute bottom-8 left-1/2 flex -translate-x-1/2 gap-2 sm:left-auto sm:right-8 sm:translate-x-0 sm:flex-col"
        >
          {BEATS.map((beat, i) => (
            <li
              key={beat.id}
              className={`h-1.5 rounded-full transition-all duration-400 sm:h-6 sm:w-1.5 ${
                i === activeIndex ? 'w-6 bg-primary sm:h-10' : 'w-1.5 bg-muted-foreground/35'
              }`}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}
