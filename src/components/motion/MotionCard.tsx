'use client';

import { motion } from 'framer-motion';
import { type ReactNode } from 'react';
import { springTransition } from './variants';

interface MotionCardProps {
  children: ReactNode;
  className?: string;
  hoverY?: number;
  hoverScale?: number;
}

export function MotionCard({
  children,
  className,
  hoverY = -4,
  hoverScale = 1.02,
}: MotionCardProps) {
  return (
    <motion.div
      whileHover={{
        y: hoverY,
        scale: hoverScale,
        transition: springTransition,
      }}
      whileTap={{ scale: 0.98 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
