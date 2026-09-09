'use client';

/**
 * Pointer-driven micro-interactions: magnetic controls and tilting cards.
 *
 * Both follow the same three rules, which are what stop this kind of effect becoming
 * annoying rather than tactile:
 *
 * 1. **The hit area never moves.** Only a child moves, or the transform is small enough that
 *    the pointer cannot end up chasing a target that has slid out from under it.
 * 2. **Fine pointers only.** A magnetic pull or a tilt driven by hover is meaningless on
 *    touch and actively confusing under `prefers-reduced-motion`, so both hooks return inert
 *    handlers in those cases rather than degrading oddly.
 * 3. **Nothing per-frame reaches React.** The transform is written straight to the node's
 *    style. Routing pointer coordinates through state would rerender on every mouse move.
 */

import { useCallback, useEffect, useRef } from 'react';

import { useMediaQuery, REDUCED_MOTION_QUERY } from './use-media-query';

const FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)';

function useEnabled() {
  const fine = useMediaQuery(FINE_POINTER_QUERY);
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY);
  return fine && !reduced;
}

/**
 * Magnetic pull. The element drifts toward the pointer while it is nearby and springs back
 * on exit.
 *
 * `strength` is capped deliberately: past roughly 0.35 the control outruns the cursor and
 * the user starts chasing it, which is the failure mode of every bad implementation of this.
 */
export function useMagnetic<T extends HTMLElement>(strength = 0.28, radius = 90) {
  const ref = useRef<T>(null);
  const enabled = useEnabled();

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    let frame: number | null = null;
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;

    const settle = () => {
      currentX += (targetX - currentX) * 0.18;
      currentY += (targetY - currentY) * 0.18;
      el.style.transform = `translate3d(${currentX.toFixed(2)}px, ${currentY.toFixed(2)}px, 0)`;
      if (Math.abs(targetX - currentX) > 0.1 || Math.abs(targetY - currentY) > 0.1) {
        frame = requestAnimationFrame(settle);
      } else {
        frame = null;
      }
    };
    const kick = () => {
      if (frame === null) frame = requestAnimationFrame(settle);
    };

    const onMove = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      const distance = Math.hypot(dx, dy);
      const reach = Math.max(rect.width, rect.height) / 2 + radius;
      if (distance > reach) {
        targetX = 0;
        targetY = 0;
      } else {
        const falloff = 1 - distance / reach;
        targetX = dx * strength * falloff;
        targetY = dy * strength * falloff;
      }
      kick();
    };
    const onLeave = () => {
      targetX = 0;
      targetY = 0;
      kick();
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerleave', onLeave);
    // Focus must not leave the control displaced somewhere the ring does not match.
    el.addEventListener('blur', onLeave);

    return () => {
      window.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('blur', onLeave);
      if (frame !== null) cancelAnimationFrame(frame);
      el.style.transform = '';
    };
  }, [enabled, strength, radius]);

  return ref;
}

/**
 * Card tilt. Rotates toward the pointer within a hard cap and resets on exit.
 *
 * The cap matters: a large tilt turns text into a keystoned mess and makes the card's own
 * links harder to hit than they were flat.
 */
export function useTilt<T extends HTMLElement>(maxDeg = 5, lift = 6) {
  const ref = useRef<T>(null);
  const enabled = useEnabled();

  const reset = useCallback((el: T) => {
    el.style.transform = '';
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    const onMove = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width - 0.5;
      const py = (event.clientY - rect.top) / rect.height - 0.5;
      el.style.transform =
        `perspective(900px) rotateX(${(-py * maxDeg).toFixed(2)}deg) ` +
        `rotateY(${(px * maxDeg).toFixed(2)}deg) translate3d(0, ${-lift}px, 0)`;
    };
    const onLeave = () => reset(el);

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('blur', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('blur', onLeave);
      reset(el);
    };
  }, [enabled, maxDeg, lift, reset]);

  return ref;
}
