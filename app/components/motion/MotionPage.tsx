'use client';

import { motion } from 'framer-motion';
import { type ReactNode } from 'react';

interface MotionPageProps {
  children: ReactNode;
  className?: string;
}

export function MotionPage({ children, className }: MotionPageProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 30 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
