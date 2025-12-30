'use client'; // This is required because we use useState

import { useState } from 'react';
import { ManagerSidebar } from "@/components/dashboard/ManagerSidebar";
import { StatsCards } from "@/components/dashboard/StatsCards";
import { InspectionsTable } from "@/components/dashboard/InspectionsTable";

export default function DashboardPage() {
  // This state tracks which tab is currently open (default is "dashboard")
  const [activeTab, setActiveTab] = useState("dashboard");

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar with state connection */}
      <ManagerSidebar 
        activeTab={activeTab} 
        onTabChange={setActiveTab} 
      />
      
      {/* Main Content */}
      <main className="flex-1 p-8 overflow-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 capitalize">{activeTab}</h1>
          <p className="text-gray-500">Overview of your fleet's safety compliance</p>
        </header>

        {/* Show content based on which tab is active */}
        {activeTab === 'dashboard' && (
          <div className="space-y-8">
            <StatsCards />
            <InspectionsTable />
          </div>
        )}

        {activeTab === 'inspections' && (
          <div className="space-y-8">
            <InspectionsTable />
          </div>
        )}

        {/* Placeholder for other tabs */}
        {(activeTab === 'equipment' || activeTab === 'settings') && (
          <div className="p-10 text-center text-gray-400 bg-white rounded-xl border border-dashed">
            Content coming soon...
          </div>
        )}
      </main>
    </div>
  );
}