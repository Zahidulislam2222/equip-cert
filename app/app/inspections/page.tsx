'use client';

import { InspectionsTable } from '@/components/dashboard/InspectionsTable';

export default function InspectionsPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Inspections</h1>
        <p className="text-muted-foreground">All equipment safety inspections</p>
      </div>
      <InspectionsTable />
    </div>
  );
}
