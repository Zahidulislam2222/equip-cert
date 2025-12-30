'use client'; // This page is now interactive

import { useState } from "react";

// --- Import all the necessary components ---
import { ManagerDashboard } from "@/components/dashboard/ManagerDashboard"; // We will create this next
import { TechnicianFlow } from "@/components/technician/TechnicianFlow";
import { useIsMobile } from "@/hooks/use-mobile"; // The hook we just created
import { Button } from "@/components/ui/button";
import { Monitor, Smartphone } from "lucide-react";

// --- Create the missing ManagerDashboard component ---
// Lovable split this into a separate file, but we can combine it for simplicity.
function ManagerDashboardComponent() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const { ManagerSidebar } = require("@/components/dashboard/ManagerSidebar");
  const { StatsCards } = require("@/components/dashboard/StatsCards");
  const { InspectionsTable } = require("@/components/dashboard/InspectionsTable");

  return (
    <div className="flex min-h-screen bg-gray-50">
      <ManagerSidebar activeTab={activeTab} onTabChange={setActiveTab} />
      <main className="flex-1 p-8 overflow-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 capitalize">{activeTab}</h1>
          <p className="text-gray-500">Overview of your fleet's safety compliance</p>
        </header>
        <div className="space-y-8">
          <StatsCards />
          <InspectionsTable />
        </div>
      </main>
    </div>
  );
}


export default function IndexPage() {
  const isMobile = useIsMobile();
  // State to manually switch between views
  const [forceView, setForceView] = useState<"auto" | "manager" | "technician">("auto");

  // Logic to decide which view to show
  const showManager = forceView === "manager" || (forceView === "auto" && !isMobile);

  return (
    <>
      {/* View Toggle Buttons */}
      <div className="fixed bottom-4 right-4 z-50 flex gap-2 animate-fade-in">
        <Button
          onClick={() => setForceView("manager")}
          variant={showManager ? "industrial" : "outline"}
          size="sm"
          className="shadow-lg"
        >
          <Monitor className="h-4 w-4" />
          <span className="hidden sm:inline ml-2">Manager</span>
        </Button>
        <Button
          onClick={() => setForceView("technician")}
          variant={!showManager ? "industrial" : "outline"}
          size="sm"
          className="shadow-lg"
        >
          <Smartphone className="h-4 w-4" />
          <span className="hidden sm:inline ml-2">Technician</span>
        </Button>
      </div>

      {/* Main Content Switcher */}
      {showManager ? <ManagerDashboardComponent /> : <TechnicianFlow />}
    </>
  );
};