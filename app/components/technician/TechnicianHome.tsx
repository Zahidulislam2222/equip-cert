import { ClipboardCheck, User, HardHat, ChevronRight, Sparkles, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TechnicianHomeProps {
  onStartInspection: (mode: "manual" | "ai") => void; // Updated to accept mode
}

export function TechnicianHome({ onStartInspection }: TechnicianHomeProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Mobile Header */}
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
            <HardHat className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-lg font-bold text-foreground">EquipCert</span>
        </div>
        <button className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
          <User className="h-5 w-5 text-muted-foreground" />
        </button>
      </header>

      {/* Main Content */}
      <main className="flex flex-1 flex-col px-4 py-6">
        {/* Greeting Section */}
        <div className="mb-6 animate-fade-in">
          <p className="text-sm font-medium text-muted-foreground">Good morning,</p>
          <h1 className="text-3xl font-bold text-foreground">Technician</h1>
          <p className="mt-2 text-muted-foreground">
            Select inspection mode:
          </p>
        </div>

        {/* Stats Summary */}
        <div className="mb-6 grid grid-cols-2 gap-4 animate-fade-in" style={{ animationDelay: "100ms" }}>
          <div className="rounded-xl bg-card p-4 shadow-sm">
            <p className="text-2xl font-bold text-foreground">12</p>
            <p className="text-sm text-muted-foreground">Today's Tasks</p>
          </div>
          <div className="rounded-xl bg-success-bg p-4 shadow-sm">
            <p className="text-2xl font-bold text-success">8</p>
            <p className="text-sm text-success/80">Completed</p>
          </div>
        </div>

        {/* ACTION BUTTONS (The New Split UI) */}
        <div className="flex flex-1 flex-col gap-4 animate-fade-in" style={{ animationDelay: "200ms" }}>
          
          {/* 1. Manual Mode (The Expert Button) */}
          <Button
            onClick={() => onStartInspection("manual")}
            className="group flex h-32 w-full items-center justify-between px-8 rounded-3xl shadow-sm hover:shadow-md transition-all border-2 border-transparent"
            variant="industrial" // Keep yellow for manual
          >
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/20 group-hover:scale-110 transition-transform">
                <ClipboardCheck className="h-8 w-8" />
              </div>
              <div className="text-left">
                <h3 className="text-xl font-bold">Manual Check</h3>
                <p className="text-sm opacity-80 font-medium">Quick List</p>
              </div>
            </div>
            <ChevronRight className="h-6 w-6 opacity-60" />
          </Button>

          {/* 2. AI Mode (The Smart Button) */}
          <Button
            onClick={() => onStartInspection("ai")}
            className="group flex h-32 w-full items-center justify-between px-8 rounded-3xl shadow-sm hover:shadow-md transition-all bg-white border-2 border-blue-100 hover:border-blue-300 text-blue-900"
            variant="outline" // Clean look for AI
          >
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-blue-600 group-hover:scale-110 transition-transform">
                <Sparkles className="h-8 w-8" />
              </div>
              <div className="text-left">
                <h3 className="text-xl font-bold">AI Guided</h3>
                <p className="text-sm text-blue-600/80 font-medium">Auto-Identify</p>
              </div>
            </div>
            <ChevronRight className="h-6 w-6 text-blue-300" />
          </Button>

        </div>
      </main>

      {/* Safe Area Padding */}
      <div className="h-6 mobile-safe-area" />
    </div>
  );
}