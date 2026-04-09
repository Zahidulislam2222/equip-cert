import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { TechnicianHome } from "./TechnicianHome";
import { InspectionScreen } from "./InspectionScreen";
import { CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

type View = "home" | "inspection" | "complete";

const viewTransition = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
  transition: { type: 'spring' as const, stiffness: 300, damping: 30 },
};

export function TechnicianFlow() {
  const [view, setView] = useState<View>("home");
  const [isAiMode, setIsAiMode] = useState(false); // <--- New State

  const handleStart = (mode: "manual" | "ai") => {
    setIsAiMode(mode === "ai");
    setView("inspection");
  };

  return (
    <AnimatePresence mode="wait">
      {view === "complete" && (
        <motion.div key="complete" {...viewTransition}>
          <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
            <div className="flex flex-col items-center text-center">
              <motion.div
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.2 }}
              >
                <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-success animate-pulse-glow">
                  <CheckCircle className="h-12 w-12 text-success-foreground" />
                </div>
              </motion.div>
              <h1 className="mb-2 text-2xl font-bold text-foreground">
                Inspection Complete!
              </h1>
              <p className="mb-8 text-muted-foreground">
                Report has been submitted to HQ.
              </p>
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
        </motion.div>
      )}

      {view === "inspection" && (
        <motion.div key="inspection" {...viewTransition}>
          <InspectionScreen
            isAiMode={isAiMode} // <--- Passing the mode
            onBack={() => setView("home")}
            onComplete={() => setView("complete")}
          />
        </motion.div>
      )}

      {view === "home" && (
        <motion.div key="home" {...viewTransition}>
          <TechnicianHome onStartInspection={handleStart} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}