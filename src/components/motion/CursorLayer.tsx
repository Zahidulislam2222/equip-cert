'use client';

/**
 * A custom cursor built out of the product's own vocabulary.
 *
 * The obvious version of this is a blurred purple blob that follows the mouse, which says
 * nothing about anything. This one is a **registration reticle**: a thin ring with four tick
 * marks, the thing you look through to line something up. It belongs to an inspection tool
 * in a way a blob does not, and it costs two elements and no library.
 *
 * Behaviour:
 *
 * - A dot tracks the pointer exactly, so precision never suffers; the ring lags behind it,
 *   which is what produces the sense of weight.
 * - Over anything interactive the ring opens up and the ticks push out, so the cursor
 *   reports affordance rather than just decorating it.
 * - Over the 3-D canvas it becomes a drag reticle.
 *
 * The real system cursor is **never hidden**. Hiding it is the standard mistake: it breaks
 * text selection feedback, it strands anyone whose JavaScript fails, and it fights every
 * accessibility tool that draws its own pointer. This layer is additive and `pointer-events:
 * none` throughout, so if it fails the page is exactly as usable as before.
 *
 * Fine pointers only, and off under `prefers-reduced-motion`.
 */

import { useEffect, useRef, useState } from 'react';

import { useMediaQuery, REDUCED_MOTION_QUERY } from '@/hooks/use-media-query';

const FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)';

/** Selector for things the reticle should open over. */
const INTERACTIVE =
  'a, button, [role="button"], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

export function CursorLayer() {
  const fine = useMediaQuery(FINE_POINTER_QUERY);
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY);
  const enabled = fine && !reduced;

  const ringRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'idle' | 'interactive' | 'drag'>('idle');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    let frame: number | null = null;
    let pointerX = window.innerWidth / 2;
    let pointerY = window.innerHeight / 2;
    let ringX = pointerX;
    let ringY = pointerY;

    const loop = () => {
      // The ring chases the dot rather than the pointer. 0.18 is the whole effect: lower
      // feels like lag, higher feels welded to the cursor and communicates nothing.
      ringX += (pointerX - ringX) * 0.18;
      ringY += (pointerY - ringY) * 0.18;
      if (ringRef.current) {
        ringRef.current.style.transform = `translate3d(${ringX.toFixed(1)}px, ${ringY.toFixed(1)}px, 0) translate(-50%, -50%)`;
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    const onMove = (event: PointerEvent) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (dotRef.current) {
        dotRef.current.style.transform = `translate3d(${pointerX}px, ${pointerY}px, 0) translate(-50%, -50%)`;
      }
      if (!visible) setVisible(true);

      const target = event.target as Element | null;
      if (!target || typeof target.closest !== 'function') return;
      if (target.closest('canvas')) setMode('drag');
      else if (target.closest(INTERACTIVE)) setMode('interactive');
      else setMode('idle');
    };

    const onLeave = () => setVisible(false);
    const onEnter = () => setVisible(true);

    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    document.addEventListener('pointerenter', onEnter);

    return () => {
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('pointerenter', onEnter);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [enabled, visible]);

  if (!enabled) return null;

  const size = mode === 'interactive' ? 54 : mode === 'drag' ? 64 : 30;
  const tick = mode === 'idle' ? 4 : 8;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[100] hidden lg:block">
      <div
        ref={ringRef}
        className="absolute left-0 top-0 transition-[width,height,opacity] duration-300 ease-out"
        style={{ width: size, height: size, opacity: visible ? 1 : 0 }}
      >
        <div
          className="absolute inset-0 rounded-full border transition-colors duration-300"
          style={{
            borderColor:
              mode === 'idle' ? 'hsl(var(--muted-foreground) / 0.45)' : 'hsl(var(--primary) / 0.9)',
          }}
        />
        {/* Four registration ticks. They push outward when the reticle opens. */}
        {[
          { top: -tick, left: '50%', w: 1, h: tick },
          { bottom: -tick, left: '50%', w: 1, h: tick },
          { left: -tick, top: '50%', w: tick, h: 1 },
          { right: -tick, top: '50%', w: tick, h: 1 },
        ].map((s, i) => (
          <span
            key={i}
            className="absolute bg-primary transition-all duration-300"
            style={{
              ...s,
              width: s.w,
              height: s.h,
              transform: i < 2 ? 'translateX(-50%)' : 'translateY(-50%)',
              opacity: mode === 'idle' ? 0.5 : 1,
            }}
          />
        ))}
      </div>

      <div
        ref={dotRef}
        className="absolute left-0 top-0 h-1 w-1 rounded-full bg-primary transition-opacity duration-300"
        style={{ opacity: visible ? 1 : 0 }}
      />
    </div>
  );
}
