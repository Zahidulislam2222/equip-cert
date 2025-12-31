'use client';

import { defineCustomElements } from '@ionic/pwa-elements/loader';
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Monitor, Smartphone } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

// --- IMPORTS ---
// We use { } because ManagerSidebar uses "export function" (Named Export)
import { ManagerSidebar } from "@/components/dashboard/ManagerSidebar";
import { TechnicianFlow } from "@/components/technician/TechnicianFlow";

// ⚠️ IMPORTANT CHECK:
// If the build fails on these two lines, it means these files use "export default".
// If that happens, change these lines to: import StatsCards from "...";
import { StatsCards } from "@/components/dashboard/StatsCards";
import { InspectionsTable } from "@/components/dashboard/InspectionsTable";

// --- Internal Component ---
function ManagerDashboardComponent() {
  const [activeTab, setActiveTab] = useState("dashboard");

  return (
    <div className="flex min-h-screen bg-gray-50">
      <ManagerSidebar activeTab={activeTab} onTabChange={setActiveTab} />
      <main className="flex-1 p-8 overflow-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 capitalize">{activeTab}</h1>
          <p className="text-gray-500">Overview of your fleet's safety compliance</p>
        </header>
        <div className="space-y-8">
          {/* These components are now properly imported at the top */}
          <StatsCards />
          <InspectionsTable />
        </div>
      </main>
    </div>
  );
}

export default function IndexPage() {
  const isMobile = useIsMobile();
  const [forceView, setForceView] = useState<"auto" | "manager" | "technician">("auto");
  const [showManager, setShowManager] = useState(true);

  useEffect(() => {
    const shouldShowManager = forceView === "manager" || (forceView === "auto" && !isMobile);
    setShowManager(shouldShowManager);
  }, [forceView, isMobile]);

// Initialize the Web Camera UI (for Laptop testing)
useEffect(() => {
  defineCustomElements(window);
}, []);

  return (
    <>
      <div className="fixed bottom-4 right-4 z-50 flex gap-2 animate-fade-in">
        <Button
          onClick={() => setForceView("manager")}
          variant={showManager ? "default" : "outline"}
          size="sm"
          className="shadow-lg"
        >
          <Monitor className="h-4 w-4" />
          <span className="hidden sm:inline ml-2">Manager</span>
        </Button>
        <Button
          onClick={() => setForceView("technician")}
          variant={!showManager ? "default" : "outline"}
          size="sm"
          className="shadow-lg"
        >
          <Smartphone className="h-4 w-4" />
          <span className="hidden sm:inline ml-2">Technician</span>
        </Button>
      </div>

      {showManager ? <ManagerDashboardComponent /> : <TechnicianFlow />}
    </>
  );
}