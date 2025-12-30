'use client'; // This component uses state, so it must be a client component

import { useState } from "react";
import { Bell, Search, User } from "lucide-react";
import { Button } from "@/components/ui/button";

// --- FIXES ARE HERE ---
import { ManagerSidebar } from "@/components/dashboard/ManagerSidebar";
import { StatsCards } from "@/components/dashboard/StatsCards"; // Corrected name from StatsOverview
import { InspectionsTable } from "@/components/dashboard/InspectionsTable";
// --------------------

export function ManagerDashboard() {
  const [activeTab, setActiveTab] = useState("dashboard");

  return (
    <div className="flex min-h-screen w-full bg-background">
      <ManagerSidebar activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="flex flex-1 flex-col">
        {/* Top Header */}
        <header className="flex h-16 items-center justify-between border-b border-border bg-card px-6">
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search inspections..."
                className="h-10 w-80 rounded-lg border border-input bg-background pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5" />
              <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                3
              </span>
            </Button>

            <div className="flex items-center gap-3 rounded-lg bg-muted px-3 py-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <User className="h-4 w-4" />
              </div>
              <div className="text-sm">
                <p className="font-medium text-foreground">Admin User</p>
                <p className="text-xs text-muted-foreground">Manager</p>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-auto p-6">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
            <p className="text-muted-foreground">
              Overview of your fleet's safety compliance
            </p>
          </div>

          <div className="space-y-6">
            <StatsCards /> {/* Corrected name */}
            <InspectionsTable />
          </div>
        </main>
      </div>
    </div>
  );
}