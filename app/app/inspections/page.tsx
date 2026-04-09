'use client';

import { InspectionsTable } from '@/components/dashboard/InspectionsTable';
import { MotionPage } from '@/components/motion/MotionPage';

export default function InspectionsPage() {
  return (
    <MotionPage className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Inspections</h1>
        <p className="text-muted-foreground">All equipment safety inspections</p>
      </div>
      <InspectionsTable />
    </MotionPage>
  );
}
