import { ClipboardCheck, User, HardHat, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TechnicianHomeProps {
  onStartInspection: () => void;
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
      <main className="flex flex-1 flex-col px-4 py-8">
        {/* Greeting Section */}
        <div className="mb-8 animate-fade-in">
          <p className="text-sm font-medium text-muted-foreground">Good morning,</p>
          <h1 className="text-3xl font-bold text-foreground">Technician</h1>
          <p className="mt-2 text-muted-foreground">
            Ready for your next inspection?
          </p>
        </div>

        {/* Stats Summary */}
        <div className="mb-8 grid grid-cols-2 gap-4 animate-fade-in" style={{ animationDelay: "100ms" }}>
          <div className="rounded-xl bg-card p-4 shadow-sm">
            <p className="text-2xl font-bold text-foreground">12</p>
            <p className="text-sm text-muted-foreground">Today's Tasks</p>
          </div>
          <div className="rounded-xl bg-success-bg p-4 shadow-sm">
            <p className="text-2xl font-bold text-success">8</p>
            <p className="text-sm text-success/80">Completed</p>
          </div>
        </div>

        {/* Main Action Button - RESTORED TO ORIGINAL */}
        <div className="flex flex-1 items-center justify-center animate-fade-in" style={{ animationDelay: "200ms" }}>
          <Button
            onClick={onStartInspection}
            className="group flex h-48 w-full max-w-sm flex-col items-center justify-center gap-4 rounded-3xl animate-pulse-glow"
            variant="industrial"
            size="xl"
          >
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary-foreground/20 transition-transform duration-300 group-hover:scale-110">
              <ClipboardCheck className="h-10 w-10" />
            </div>
            <span className="text-xl font-bold">Start New Inspection</span>
          </Button>
        </div>

        {/* Recent Activity */}
        <div className="mt-8 animate-fade-in" style={{ animationDelay: "300ms" }}>
          <h2 className="mb-4 text-lg font-semibold text-foreground">
            Recent Activity
          </h2>
          <div className="space-y-3">
            {[
              { name: "Caterpillar X500", time: "2h ago", status: "completed" },
              { name: "Komatsu D65PX", time: "4h ago", status: "completed" },
            ].map((item, index) => (
              <button
                key={index}
                className="flex w-full items-center justify-between rounded-xl bg-card p-4 shadow-sm transition-all active:scale-[0.98]"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-success-bg">
                    <ClipboardCheck className="h-6 w-6 text-success" />
                  </div>
                  <div className="text-left">
                    <p className="font-medium text-foreground">{item.name}</p>
                    <p className="text-sm text-muted-foreground">{item.time}</p>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </button>
            ))}
          </div>
        </div>
      </main>

      {/* Safe Area Padding */}
      <div className="h-6 mobile-safe-area" />
    </div>
  );
}