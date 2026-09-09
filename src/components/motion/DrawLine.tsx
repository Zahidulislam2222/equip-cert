'use client';

import { motion, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';

interface DrawLineProps {
  className?: string;
  orientation?: 'horizontal' | 'vertical';
  color?: string;
  strokeWidth?: number;
}

export function DrawLine({
  className,
  orientation = 'horizontal',
  color = 'hsl(45 100% 55% / 0.3)',
  strokeWidth = 2,
}: DrawLineProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start 80%', 'end 40%'],
  });

  const pathLength = useTransform(scrollYProgress, [0, 1], [0, 1]);

  const isHorizontal = orientation === 'horizontal';
  const viewBox = isHorizontal ? '0 0 400 2' : '0 0 2 400';
  const d = isHorizontal ? 'M0 1 L400 1' : 'M1 0 L1 400';

  return (
    <div ref={ref} className={className}>
      <svg
        viewBox={viewBox}
        fill="none"
        className={isHorizontal ? 'w-full h-[2px]' : 'h-full w-[2px]'}
        preserveAspectRatio="none"
      >
        <motion.path
          d={d}
          stroke={color}
          strokeWidth={strokeWidth}
          style={{ pathLength }}
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
