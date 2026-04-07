'use client';

import { Users } from 'lucide-react';

export default function TeamPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Team Management</h1>
        <p className="text-muted-foreground">Manage technicians and managers in your organization</p>
      </div>
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Users className="h-16 w-16 mb-4 opacity-30" />
        <p className="text-lg font-medium">Team Directory</p>
        <p className="text-sm">Coming in Phase 2 — Invite members, assign roles, manage permissions</p>
      </div>
    </div>
  );
}
