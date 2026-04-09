'use client';

import { StatsCards } from '@/components/dashboard/StatsCards';
import { InspectionsTable } from '@/components/dashboard/InspectionsTable';
import { CorrectiveActionList } from '@/components/corrective/CorrectiveActionList';
import { useAuth } from '@/components/auth/AuthProvider';
import { AlertTriangle } from 'lucide-react';
import { MotionPage } from '@/components/motion/MotionPage';

export default function DashboardPage() {
  const { profile } = useAuth();

  return (
    <MotionPage className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold font-display text-foreground">
          {profile ? `Welcome back, ${profile.full_name.split(' ')[0]}` : 'Dashboard'}
        </h1>
        <p className="text-muted-foreground">Overview of your fleet&apos;s safety compliance</p>
      </div>

      <StatsCards />

      <div className="grid gap-8 xl:grid-cols-3">
        {/* Inspections — takes 2 cols */}
        <div className="xl:col-span-2">
          <InspectionsTable />
        </div>

        {/* Corrective Actions sidebar */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
          <div className="flex items-center gap-3 mb-5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-warning/10">
              <AlertTriangle className="h-5 w-5 text-warning" />
            </div>
            <div>
              <h3 className="font-semibold font-display text-foreground">Corrective Actions</h3>
              <p className="text-xs text-muted-foreground">Issues requiring attention</p>
            </div>
          </div>
          <CorrectiveActionList />
        </div>
      </div>
    </MotionPage>
  );
}
