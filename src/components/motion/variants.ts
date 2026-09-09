'use client';

import type { Transition, Variants } from 'framer-motion';

// === Transition Presets ===
export const springTransition: Transition = { type: 'spring', stiffness: 300, damping: 30 };
export const gentleSpring: Transition = { type: 'spring', stiffness: 200, damping: 25 };
export const snappySpring: Transition = { type: 'spring', stiffness: 400, damping: 35 };

// === Variant Presets ===
export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: gentleSpring },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.5 } },
};

export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.08, delayChildren: 0.1 },
  },
};

export const staggerContainerSlow: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.12, delayChildren: 0.15 },
  },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: { opacity: 1, scale: 1, transition: gentleSpring },
};

export const slideInLeft: Variants = {
  hidden: { opacity: 0, x: -40 },
  visible: { opacity: 1, x: 0, transition: gentleSpring },
};

export const slideInRight: Variants = {
  hidden: { opacity: 0, x: 40 },
  visible: { opacity: 1, x: 0, transition: gentleSpring },
};

// === Hover Presets ===
export const hoverLift = {
  y: -4,
  scale: 1.02,
  transition: springTransition,
};

export const hoverGlow = {
  y: -2,
  boxShadow: '0 0 30px -5px hsl(45 100% 55% / 0.3)',
  transition: springTransition,
};

export const tapScale = {
  scale: 0.97,
};
