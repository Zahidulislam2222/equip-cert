'use client';

/**
 * Media queries as React state, without a hydration mismatch.
 *
 * `useSyncExternalStore` is the right primitive here rather than `useEffect` + `useState`:
 * the server snapshot is explicit, so the static export renders the same markup the server
 * produced and then corrects itself on the client, instead of flashing the wrong branch.
 *
 * The server snapshot is deliberately `false` for both queries below. Guessing "probably
 * mobile" on the server would render the still-plus-list composition into the HTML and then
 * tear it down on every desktop visit.
 */

import { useSyncExternalStore } from 'react';

/**
 * A coarse pointer matters as much as a narrow viewport. A small laptop window is still a
 * desktop; a large tablet is still touch. Both branches below rely on this distinction.
 */
export const MOBILE_QUERY = '(max-width: 860px), (hover: none) and (pointer: coarse)';
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

type QueryStore = {
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => boolean;
};

/**
 * Cached per query, and it has to be.
 *
 * `useSyncExternalStore` resubscribes whenever the identity of `subscribe` changes, so
 * building the closure inline would tear down and re-add a `matchMedia` listener on every
 * single render.
 */
const stores = new Map<string, QueryStore>();

function storeFor(query: string): QueryStore {
  let store = stores.get(query);
  if (!store) {
    store = {
      subscribe: (onChange) => {
        const mq = window.matchMedia(query);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
      },
      getSnapshot: () => window.matchMedia(query).matches,
    };
    stores.set(query, store);
  }
  return store;
}

const serverSnapshot = () => false;

export function useMediaQuery(query: string): boolean {
  const store = storeFor(query);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, serverSnapshot);
}

export const useIsMobile = () => useMediaQuery(MOBILE_QUERY);

/**
 * Read live, not captured at mount: a visitor can turn reduced motion on mid-session and
 * the page has to honour it without a reload.
 */
export const usePrefersReducedMotion = () => useMediaQuery(REDUCED_MOTION_QUERY);
