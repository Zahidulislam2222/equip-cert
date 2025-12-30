import { useState } from "react";
import { TechnicianHome } from "./TechnicianHome";
import { InspectionScreen } from "./InspectionScreen";
import { CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

type View = "home" | "inspection" | "complete";

export function TechnicianFlow() {
  const [view, setView] = useState<View>("home");

  if (view === "complete") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
        <div className="flex flex-col items-center text-center animate-scale-in">
          <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-success animate-pulse-glow">
            <CheckCircle className="h-12 w-12 text-success-foreground" />
          </div>
          <h1 className="mb-2 text-2xl font-bold text-foreground">
            Inspection Complete!
          </h1>
          <p className="mb-8 text-muted-foreground">
            Report has been submitted and signed.
          </p>
          {/* FIX: Changed variant to 'default' so it is solid Blue */}
          <Button
            onClick={() => setView("home")}
            variant="default" 
            size="xl"
            className="w-full max-w-xs shadow-lg"
          >
            Back to Home
          </Button>
        </div>
      </div>
    );
  }

  if (view === "inspection") {
    return (
      <InspectionScreen
        onBack={() => setView("home")}
        onComplete={() => setView("complete")}
      />
    );
  }

  return <TechnicianHome onStartInspection={() => setView("inspection")} />;
}