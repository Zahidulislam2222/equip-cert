import { useState } from "react";
import {
  ArrowLeft,
  Camera,
  AlertTriangle,
  CheckCircle,
  X,
  Pen,
  Loader2 // Spinner icon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase"; // <--- Database Connection

interface InspectionScreenProps {
  onBack: () => void;
  onComplete: () => void;
}

interface ChecklistItem {
  id: string;
  question: string;
  status: "pending" | "pass" | "fail";
}

const initialChecklist: ChecklistItem[] = [
  { id: "1", question: "Hydraulic Fluid Level", status: "pending" },
  { id: "2", question: "Brake System Functional", status: "pending" },
  { id: "3", question: "Safety Guards in Place", status: "pending" },
  { id: "4", question: "Warning Lights Working", status: "pending" },
  { id: "5", question: "Fire Extinguisher Present", status: "pending" },
  { id: "6", question: "Seat Belt Condition", status: "pending" },
];

export function InspectionScreen({ onBack, onComplete }: InspectionScreenProps) {
  const [checklist, setChecklist] = useState<ChecklistItem[]>(initialChecklist);
  const [scanned, setScanned] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false); // Loading state

  const updateStatus = (id: string, status: "pass" | "fail") => {
    setChecklist((items) =>
      items.map((item) => (item.id === id ? { ...item, status } : item))
    );
  };

  const allCompleted = checklist.every((item) => item.status !== "pending");
  const hasFailures = checklist.some((item) => item.status === "fail");

  // --- REAL DATABASE SAVE FUNCTION ---
  const handleSave = async () => {
    setIsSubmitting(true);

    try {
      const payload = {
        equipment_name: "Caterpillar X500",
        inspector_name: "John Martinez",
        checklist_data: checklist,
        status: hasFailures ? "Action Required" : "Safe",
        created_at: new Date().toISOString() // Current time
      };

      // Send to Supabase
      const { error } = await supabase
        .from('inspections')
        .insert([payload]);

      if (error) {
        console.error("Database Error:", error);
        alert(`Error: ${error.message}`);
      } else {
        // Success!
        onComplete();
      }

    } catch (err) {
      console.error("System Error:", err);
      alert("Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-border bg-card px-4 py-4">
        <button onClick={onBack} className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted active:scale-95">
          <ArrowLeft className="h-5 w-5 text-foreground" />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-foreground">Caterpillar X500</h1>
          <p className="text-sm text-muted-foreground">Serial: CAT-2024-X500</p>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto px-4 py-6">
        {/* Camera */}
        <div className="mb-6 animate-fade-in">
          <div className={cn("relative overflow-hidden rounded-2xl border-2 border-dashed transition-all duration-300", scanned ? "border-success bg-success-bg" : "border-muted-foreground/30 bg-muted/50")}>
            <div className="relative flex aspect-video items-center justify-center">
              {!scanned ? (
                <Button onClick={() => setScanned(true)} variant="touch" className="gap-3">
                  <Camera className="h-6 w-6" /> Scan Equipment
                </Button>
              ) : (
                <div className="flex flex-col items-center gap-2 py-8">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success">
                    <CheckCircle className="h-8 w-8 text-success-foreground" />
                  </div>
                  <p className="font-semibold text-success">Equipment Verified</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Checklist */}
        <div className="space-y-3">
          {checklist.map((item) => (
            <div key={item.id} className="rounded-xl bg-card p-4 shadow-sm border">
              <div className="flex items-center justify-between gap-4">
                <p className="flex-1 font-medium text-foreground">{item.question}</p>
                <div className="flex gap-2">
                  <Button 
                    onClick={() => updateStatus(item.id, "pass")} 
                    variant={item.status === "pass" ? "touch-success" : "touch-outline"}
                    className={cn("min-w-[72px]", item.status === "pass" && "ring-2 ring-success/30")}
                  >
                    <CheckCircle className="h-5 w-5" /> Pass
                  </Button>
                  <Button 
                    onClick={() => updateStatus(item.id, "fail")} 
                    variant={item.status === "fail" ? "touch-fail" : "touch-outline"}
                    className={cn("min-w-[72px]", item.status === "fail" && "ring-2 ring-destructive/30")}
                  >
                    <X className="h-5 w-5" /> Fail
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Footer */}
      <div className="sticky bottom-0 border-t border-border bg-card p-4 mobile-safe-area">
        <Button
          onClick={handleSave}
          disabled={!allCompleted || isSubmitting}
          variant={allCompleted ? (hasFailures ? "warning" : "success") : "default"}
          className="w-full gap-2"
          size="xl"
        >
          {isSubmitting ? (
            <> <Loader2 className="h-5 w-5 animate-spin" /> Saving... </>
          ) : (
            <> <Pen className="h-5 w-5" /> {allCompleted ? "Complete & Sign" : "Fill Checklist"} </>
          )}
        </Button>
      </div>
    </div>
  );
}