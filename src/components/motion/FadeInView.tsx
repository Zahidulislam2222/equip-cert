'use client';

import { motion } from 'framer-motion';
import { type ReactNode } from 'react';
import { gentleSpring } from './variants';

type Direction = 'up' | 'down' | 'left' | 'right';

interface FadeInViewProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  direction?: Direction;
  duration?: number;
}

const offsets: Record<Direction, { x?: number; y?: number }> = {
  up: { y: 30 },
  down: { y: -30 },
  left: { x: -40 },
  right: { x: 40 },
};

export function FadeInView({
  children,
  className,
  delay = 0,
  direction = 'up',
  duration,
}: FadeInViewProps) {
  const offset = offsets[direction];

  return (
    <motion.div
      initial={{ opacity: 0, ...offset }}
      whileInView={{ opacity: 1, x: 0, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={
        duration
          ? { duration, delay }
          : { ...gentleSpring, delay }
      }
      className={className}
    >
      {children}
    </motion.div>
  );
}
