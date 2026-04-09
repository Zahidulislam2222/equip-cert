'use client';

import { Users } from 'lucide-react';
import { MotionPage } from '@/components/motion/MotionPage';
import { motion } from 'framer-motion';

export default function TeamPage() {
  return (
    <MotionPage className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Team Management</h1>
        <p className="text-muted-foreground">Manage technicians and managers in your organization</p>
      </div>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.15, type: 'spring', stiffness: 200, damping: 25 }}
        className="flex flex-col items-center justify-center py-20 text-muted-foreground"
      >
        <Users className="h-16 w-16 mb-4 opacity-30" />
        <p className="text-lg font-medium">Team Directory</p>
        <p className="text-sm">Coming in Phase 2 — Invite members, assign roles, manage permissions</p>
      </motion.div>
    </MotionPage>
  );
}
