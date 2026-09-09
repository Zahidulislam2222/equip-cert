'use client';

/**
 * Scroll-scrubbed video.
 *
 * The section is taller than the viewport; a sticky inner frame holds the video and the
 * scroll position inside that section drives `video.currentTime`. No WebGL, no animation
 * library — one MP4 and a rAF loop.
 *
 * Three behaviours are not optional, each learned from a real failure mode:
 *  - **Seek coalescing.** Never issue a new `currentTime` while the decoder is still
 *    `seeking`. Fast flicks otherwise pile up seeks and freeze the element.
 *  - **Poster until first paint.** A `<video>` renders transparent until it decodes a
 *    frame, so the poster stays on top until `seeked`/`loadeddata` actually fires.
 *  - **Graceful absence.** If no source is given, or it fails to load, the poster (or the
 *    children alone) carries the section. The page must never depend on the asset.
 *
 * Requires HTTP Range support on the server — see `parseRange` in `deploy/server.ts`.
 */

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

/**
 * Phone detection as an external store.
 *
 * `matchMedia` does not exist during static generation, so the server snapshot is false
 * and the client corrects it on hydration. Subscribing (rather than setting state in an
 * effect) also means a desktop resize across the breakpoint swaps the source with no
 * cascading render.
 */
const MOBILE_QUERY = '(max-width: 860px), (hover: none) and (pointer: coarse)';

function subscribeMobile(onChange: () => void) {
  const mq = window.matchMedia(MOBILE_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

const getMobileSnapshot = () => window.matchMedia(MOBILE_QUERY).matches;
const getMobileServerSnapshot = () => false;

type Props = {
  /** Desktop source. Omit to render the poster/fallback only. */
  src?: string;
  /** Lighter, tighter-GOP variant for phones. Falls back to `src`. */
  srcMobile?: string;
  /** Shown before the first decoded frame, and whenever video is unavailable. */
  poster?: string;
  /** Smaller poster for phones; falls back to `poster`. */
  posterMobile?: string;
  /** Scroll distance driving the clip, in viewport heights. */
  scrollVh?: number;
  /** Overlay content, pinned above the video inside the sticky frame. */
  children?: ReactNode;
  className?: string;
};

export function ScrollScrubVideo({
  src,
  srcMobile,
  poster,
  posterMobile,
  scrollVh = 3,
  children,
  className = '',
}: Props) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const seekingRef = useRef(false);
  const targetRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const [painted, setPainted] = useState(false);
  const [failed, setFailed] = useState(false);

  const isMobile = useSyncExternalStore(
    subscribeMobile,
    getMobileSnapshot,
    getMobileServerSnapshot
  );

  // Choosing on the client keeps the heavier desktop file off a phone's network entirely.
  const source = isMobile ? srcMobile || src : src;
  const posterSrc = isMobile ? posterMobile || poster : poster;

  useEffect(() => {
    const section = sectionRef.current;
    const video = videoRef.current;
    if (!section || !video || !source || failed) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    const onSeeking = () => {
      seekingRef.current = true;
    };
    const onSeeked = () => {
      seekingRef.current = false;
      setPainted(true);
      // A seek requested while the decoder was busy was dropped; apply the latest now.
      applyTarget();
    };

    function applyTarget() {
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
      applyTarget();
    };

    const schedule = () => {
      // Cancel-and-reschedule, never skip-if-pending: the skip form latches forever
      // if a single rAF callback is dropped, freezing the scroll effect permanently.
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
    };

    video.addEventListener('seeking', onSeeking);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('loadeddata', () => setPainted(true));
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    schedule();

    return () => {
      video.removeEventListener('seeking', onSeeking);
      video.removeEventListener('seeked', onSeeked);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [source, failed]);

  // iOS will not decode a frame until the element has been played once under a user
  // gesture. A muted play/pause on first touch is enough to unblock seeking.
  useEffect(() => {
    if (!source) return;
    const prime = () => {
      const el = videoRef.current;
      if (!el) return;
      el.play().then(() => el.pause()).catch(() => {
        /* Autoplay refusal is fine — the poster is already carrying the frame. */
      });
      window.removeEventListener('touchstart', prime);
    };
    window.addEventListener('touchstart', prime, { once: true, passive: true });
    return () => window.removeEventListener('touchstart', prime);
  }, [source]);

  const showVideo = Boolean(source) && !failed;

  // Without a clip there is nothing to scrub, so the section collapses to a single
  // viewport instead of leaving the reader scrolling through empty height.
  const effectiveVh = showVideo ? scrollVh : 1;

  return (
    <div
      ref={sectionRef}
      className={`relative ${className}`}
      style={{ height: `${effectiveVh * 100}vh` }}
    >
      <div className="sticky top-0 h-[100dvh] w-full overflow-hidden">
        {/* Poster: the frame before decode, and the whole picture when there is no clip. */}
        {posterSrc ? (
          <div
            aria-hidden
            className="absolute inset-0 bg-cover bg-center transition-opacity duration-500"
            style={{
              backgroundImage: `url(${posterSrc})`,
              opacity: showVideo && painted ? 0 : 1,
            }}
          />
        ) : null}

        {showVideo ? (
          <video
            ref={videoRef}
            src={source}
            poster={posterSrc}
            preload="auto"
            muted
            playsInline
            // Never `autoPlay`: scroll owns the timeline, not the clock.
            disablePictureInPicture
            aria-hidden
            onError={() => setFailed(true)}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : null}

        {children}
      </div>
    </div>
  );
}
