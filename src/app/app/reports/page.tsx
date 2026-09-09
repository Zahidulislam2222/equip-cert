'use client';

import { BarChart3 } from 'lucide-react';
import { MotionPage } from '@/components/motion/MotionPage';
import { motion } from 'framer-motion';

export default function ReportsPage() {
  return (
    <MotionPage className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Reports & Analytics</h1>
        <p className="text-muted-foreground">Safety compliance trends and export data</p>
      </div>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.15, type: 'spring', stiffness: 200, damping: 25 }}
        className="flex flex-col items-center justify-center py-20 text-muted-foreground"
      >
        <BarChart3 className="h-16 w-16 mb-4 opacity-30" />
        <p className="text-lg font-medium">Analytics Dashboard</p>
        <p className="text-sm">Coming in Phase 3 — Charts, trends, exportable reports</p>
      </motion.div>
    </MotionPage>
  );
}
