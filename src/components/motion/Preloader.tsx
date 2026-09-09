'use client';

/**
 * The opening frame: a pressure gauge coming up to charge.
 *
 * A preloader is either the first thing that says what a product is, or it is a spinner that
 * says nothing. The reference that prompted this one (Oryzo) uses calibrating registration
 * circles, and the calibration reads as the product's own idea rather than as a wait.
 *
 * Ours is the gauge from the extinguisher: the needle sweeps off the peg, through the red,
 * and settles inside the green band, while the reticle ticks lock on. That is the first
 * inspection on the page, performed before a word of copy is read.
 *
 * Safety rules, because a preloader is the easiest way to hide your entire site:
 *
 * - It is rendered by React, so **without JavaScript it never exists** and the page is
 *   untouched.
 * - A hard ceiling dismisses it regardless of what the network is doing. A stalled asset
 *   delays the reveal; it can never prevent it.
 * - Once per session. A returning visitor should not sit through the same ceremony.
 * - Skipped entirely under `prefers-reduced-motion`, which is a request not to be made to
 *   wait through animation.
 * - `aria-hidden` and inert: the real content is in the DOM the whole time, so assistive
 *   technology and search engines never see the curtain.
 */

import { useEffect, useState } from 'react';

/** Long enough to read as deliberate, short enough not to be a toll booth. */
const MIN_MS = 1100;
/** The ceiling. Whatever is still loading, the page is handed over at this point. */
const MAX_MS = 3200;
const SESSION_KEY = 'ec:intro-played';

export function Preloader() {
  const [state, setState] = useState<'checking' | 'playing' | 'done'>('checking');

  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];
    let onLoad: (() => void) | null = null;

    // The decision is deferred by a tick rather than taken in the effect body. Setting state
    // synchronously inside an effect cascades renders, and React's lint rule is right to
    // reject it. Deferring also means that if timers never run, the state stays 'checking',
    // which renders nothing — the failure direction that leaves the page usable.
    const decide = () => {
      if (cancelled) return;

      let reduced = false;
      let seen = false;
      try {
        reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        seen = sessionStorage.getItem(SESSION_KEY) === '1';
      } catch {
        // Private mode can throw on sessionStorage. Play it: a repeated intro is a far
        // smaller problem than a crash inside the thing covering the page.
      }
      if (reduced || seen) {
        setState('done');
        return;
      }

      setState('playing');
      const started = performance.now();

      const finish = () => {
        if (cancelled) return;
        try {
          sessionStorage.setItem(SESSION_KEY, '1');
        } catch {
          /* not important enough to fail over */
        }
        setState('done');
      };

      onLoad = () => {
        timers.push(
          window.setTimeout(finish, Math.max(0, MIN_MS - (performance.now() - started)))
        );
      };

      if (document.readyState === 'complete') onLoad();
      else window.addEventListener('load', onLoad, { once: true });

      // The ceiling. Whatever is still loading, the page is handed over at this point.
      timers.push(window.setTimeout(finish, MAX_MS));
    };

    timers.push(window.setTimeout(decide, 0));

    return () => {
      cancelled = true;
      timers.forEach((id) => window.clearTimeout(id));
      if (onLoad) window.removeEventListener('load', onLoad);
    };
  }, []);

  if (state === 'checking' || state === 'done') {
    // 'checking' renders nothing too: a one-frame flash of a curtain is worse than no curtain.
    return null;
  }

  return (
    <div
      aria-hidden
      className="ec-intro fixed inset-0 z-[200] flex items-center justify-center bg-background"
    >
      <div className="bg-grid absolute inset-0 opacity-40" />
      <div className="relative flex flex-col items-center">
        <svg width="132" height="132" viewBox="0 0 132 132" fill="none">
          {/* dial */}
          <circle cx="66" cy="66" r="52" stroke="hsl(var(--border))" strokeWidth="1" />
          <circle cx="66" cy="66" r="41" stroke="hsl(var(--border))" strokeWidth="1" strokeDasharray="2 5" />
          {/* the green band an inspector is looking for */}
          <path
            d="M 38 92 A 38 38 0 0 1 38 40"
            stroke="hsl(var(--success))"
            strokeWidth="3"
            strokeLinecap="round"
            transform="rotate(180 66 66)"
            opacity="0.85"
          />
          {/* needle: sweeps off the peg and settles in the band */}
          <g className="ec-needle" style={{ transformOrigin: '66px 66px' }}>
            <line x1="66" y1="66" x2="66" y2="26" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinecap="round" />
            <circle cx="66" cy="66" r="4" fill="hsl(var(--primary))" />
          </g>
          {/* registration ticks locking on */}
          {[0, 90, 180, 270].map((deg, i) => (
            <line
              key={deg}
              className="ec-tick"
              x1="66"
              y1="6"
              x2="66"
              y2="14"
              stroke="hsl(var(--primary))"
              strokeWidth="1.5"
              transform={`rotate(${deg} 66 66)`}
              style={{ animationDelay: `${120 * i}ms` }}
            />
          ))}
        </svg>
        <p className="mt-7 text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
          Charging
        </p>
      </div>
    </div>
  );
}
