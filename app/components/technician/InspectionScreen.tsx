'use client';

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Camera,
  CheckCircle,
  X,
  Loader2,
  Sparkles,
  ScanEye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StaggerContainer, StaggerItem } from "@/components/motion/StaggerGrid";
import { FadeInView } from "@/components/motion/FadeInView";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { contentfulClient } from "@/lib/contentful";
import { Camera as CapCamera, CameraResultType } from "@capacitor/camera";
import { useAuth } from "@/components/auth/AuthProvider";
import { GPSCapture } from "@/components/shared/GPSCapture";
import type { LocationData } from "@/components/shared/GPSCapture";
import { SignaturePad } from "@/components/shared/SignaturePad";
import { CorrectiveActionForm } from "@/components/corrective/CorrectiveActionForm";
import { queueSubmission } from "@/lib/offline";
import { supabase as supabaseClient } from "@/lib/supabase";
import { toast } from "sonner";

interface InspectionScreenProps {
  isAiMode: boolean;
  onBack: () => void;
  onComplete: () => void;
}

interface ChecklistItem {
  id: string;
  question: string;
  status: "pending" | "pass" | "fail";
}

export function InspectionScreen({ isAiMode, onBack, onComplete }: InspectionScreenProps) {
  const { profile, organization } = useAuth();

  // State
  const [equipmentName, setEquipmentName] = useState<string>(isAiMode ? "Unknown Equipment" : "Caterpillar X500");
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);

  // Photo State
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);

  // GPS + Signature State
  const [location, setLocation] = useState<LocationData | null>(null);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);

  // Corrective Action State
  const [correctiveItem, setCorrectiveItem] = useState<ChecklistItem | null>(null);
  const [submittedInspectionId, setSubmittedInspectionId] = useState<number | null>(null);

  // UI State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(!isAiMode);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // --- 1. FETCH FROM CONTENTFUL ---
  const fetchChecklistFromContentful = async (nameToSearch: string) => {
    setIsSyncing(true);
    try {
      const response = await contentfulClient.getEntries({
        content_type: 'checklist',
        include: 2,
      });

      if (response.items.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const matchingEntry = response.items.find((item: Record<string, any>) => {
          const linkedEntry = item.fields.equipmentType as Record<string, Record<string, string>>;
          const linkedName = linkedEntry?.fields?.name || "";
          return nameToSearch.toLowerCase().includes(linkedName.toLowerCase()) ||
                 linkedName.toLowerCase().includes(nameToSearch.toLowerCase());
        });

        const item = matchingEntry || response.items[0];
        const rawData = item.fields.questions as Record<string, unknown> | unknown[];
        const rawList = rawData ? (Array.isArray(rawData) ? rawData : (rawData as Record<string, unknown[]>).questions || []) : [];

        if (rawList.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mappedItems = rawList.map((q: any, i: number) => ({
            id: (i + 1).toString(),
            question: q.text || q.question || "Unknown Question",
            status: "pending" as const,
          }));
          setChecklist(mappedItems);
        } else {
          setChecklist([{ id: "1", question: "Check General Condition", status: "pending" }]);
        }
      }
    } catch (error) {
      console.error("Contentful Error:", error);
    } finally {
      setIsSyncing(false);
    }
  };

  // --- 2. INITIAL LOAD ---
  useEffect(() => {
    if (!isAiMode) {
      fetchChecklistFromContentful("Caterpillar X500");
    }
  }, [isAiMode]);

  // --- 3. AI ANALYSIS ---
  const analyzeWithAI = async (blob: Blob) => {
    setIsAnalyzing(true);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        const base64data = reader.result?.toString().split(',')[1];
        // Get auth token for API call
        const { data: { session } } = await supabaseClient.auth.getSession();
        const token = session?.access_token || '';

        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ image: base64data, mimeType: blob.type }),
        });

        if (!response.ok) throw new Error(`API failed with status ${response.status}`);
        const data = await response.json();

        if (data.equipmentName) {
          setEquipmentName(data.equipmentName);
          await fetchChecklistFromContentful(data.equipmentName);
        } else {
          throw new Error("AI did not return equipment name.");
        }
      };
    } catch (error) {
      console.error("AI API Error:", error);
      toast.error("AI Service Unavailable. Check API Key.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // --- 4. CAMERA ---
  const takePhoto = async () => {
    try {
      const image = await CapCamera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Uri,
      });

      if (image.webPath) {
        setPhotoUrl(image.webPath);
        const response = await fetch(image.webPath);
        const blob = await response.blob();
        setPhotoBlob(blob);

        if (isAiMode && checklist.length === 0) {
          await analyzeWithAI(blob);
        }
      }
    } catch {
      // Camera cancelled
    }
  };

  // --- 5. CHECKLIST ---
  const updateStatus = (id: string, status: "pass" | "fail") => {
    setChecklist((items) =>
      items.map((item) => (item.id === id ? { ...item, status } : item))
    );

    // If marking as fail, prompt corrective action
    if (status === "fail") {
      const failedItem = checklist.find((item) => item.id === id);
      if (failedItem) {
        setCorrectiveItem({ ...failedItem, status: "fail" });
      }
    }
  };

  const allCompleted = checklist.length > 0 && checklist.every((item) => item.status !== "pending");
  const hasFailures = checklist.some((item) => item.status === "fail");
  const readyToSubmit = allCompleted && signatureDataUrl;

  // --- 6. SAVE ---
  const handleSave = async () => {
    setIsSubmitting(true);
    try {
      let uploadedImageUrl: string | null = null;
      let uploadedSignatureUrl: string | null = null;

      // Upload photo
      if (photoBlob) {
        const fileName = `inspection-${Date.now()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('photos')
          .upload(fileName, photoBlob);

        if (!uploadError) {
          const { data: publicUrlData } = supabase.storage.from('photos').getPublicUrl(fileName);
          uploadedImageUrl = publicUrlData.publicUrl;
        }
      }

      // Upload signature
      if (signatureDataUrl) {
        const sigBlob = await fetch(signatureDataUrl).then((r) => r.blob());
        const sigFileName = `signature-${Date.now()}.png`;
        const { error: sigError } = await supabase.storage
          .from('photos')
          .upload(sigFileName, sigBlob);

        if (!sigError) {
          const { data: sigUrlData } = supabase.storage.from('photos').getPublicUrl(sigFileName);
          uploadedSignatureUrl = sigUrlData.publicUrl;
        }
      }

      const payload = {
        equipment_name: equipmentName,
        inspector_name: profile?.full_name || (isAiMode ? "AI Assistant" : "Unknown"),
        inspector_id: profile?.id || null,
        organization_id: organization?.id || null,
        checklist_data: checklist,
        status: hasFailures ? "Action Required" : "Safe",
        photo_url: uploadedImageUrl,
        signature_url: uploadedSignatureUrl,
        location_lat: location?.lat || null,
        location_lng: location?.lng || null,
        location_address: location?.address || null,
        device_info: {
          userAgent: navigator.userAgent,
          timestamp: new Date().toISOString(),
          signedBy: profile?.full_name || 'Unknown',
          // OSHA-required fields
          inspectorJobTitle: profile?.role || 'technician',
          inspectorQualifications: profile?.qualifications || null,
          signedAt: signatureDataUrl ? new Date().toISOString() : null,
        },
      };

      if (!navigator.onLine) {
        // Queue for offline sync
        await queueSubmission({ payload, photoBlob, timestamp: Date.now() });
        toast.info("Saved offline — will sync when back online");
        onComplete();
        return;
      }

      const { data, error } = await supabase.from('inspections').insert([payload]).select('id').single();

      if (error) throw error;

      if (data?.id) {
        setSubmittedInspectionId(data.id);
      }

      toast.success("Inspection submitted successfully");
      onComplete();
    } catch (err: unknown) {
      console.error("Error:", err);
      toast.error(err instanceof Error ? err.message : "Failed to save inspection");
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
          <h1 className="text-lg font-bold font-display text-foreground">
            {isAnalyzing ? "Identifying..." : equipmentName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isAiMode ? (isAnalyzing ? "AI Vision Active" : "AI Mode") : "Manual Mode"}
          </p>
        </div>
        {isAiMode && (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
        )}
      </header>

      <main className="flex-1 overflow-auto px-4 py-6 space-y-6">

        {/* Photo / Scan UI */}
        <FadeInView>
          <div className={cn("relative overflow-hidden rounded-2xl border-2 border-dashed transition-all duration-300",
            photoUrl ? "border-success bg-success-bg" : "border-muted-foreground/30 bg-muted/50",
            isAiMode && !photoUrl && "border-primary/40 bg-primary-light"
          )}>
            <div className="relative flex aspect-video items-center justify-center">
              {!photoUrl ? (
                <Button onClick={takePhoto} variant={isAiMode ? "default" : "outline"} className={cn("gap-3", isAiMode && "h-16 px-8 rounded-full shadow-industrial")}>
                  {isAiMode ? <ScanEye className="h-6 w-6" /> : <Camera className="h-6 w-6" />}
                  {isAiMode ? "Take Photo to Identify" : "Scan Equipment"}
                </Button>
              ) : (
                <div className="relative h-full w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photoUrl} alt="Equipment" className="h-full w-full object-cover" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <div className="flex flex-col items-center gap-2">
                      {isAnalyzing ? (
                        <div className="flex flex-col items-center gap-3 bg-white/90 p-4 rounded-xl shadow-xl">
                          <Loader2 className="h-8 w-8 animate-spin text-primary" />
                          <p className="font-semibold text-foreground">Analyzing...</p>
                        </div>
                      ) : (
                        <>
                          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success">
                            <CheckCircle className="h-6 w-6 text-success-foreground" />
                          </div>
                          <p className="font-semibold text-white">{isAiMode ? "Identified" : "Verified"}</p>
                          <Button size="sm" variant="secondary" onClick={takePhoto}>Retake</Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </FadeInView>

        {/* GPS Capture */}
        <FadeInView delay={0.05}>
          <GPSCapture onCapture={setLocation} location={location} />
        </FadeInView>

        {/* Checklist */}
        <div className="space-y-3">
          {isSyncing ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Fetching Safety Rules...
            </div>
          ) : checklist.length === 0 && isAiMode && !photoUrl ? (
            <div className="text-center py-8 px-4 text-muted-foreground">
              <Sparkles className="mx-auto h-12 w-12 text-primary/20 mb-4" />
              <p>Take a photo of the equipment.</p>
              <p className="text-sm">The AI will identify it and load the correct checklist.</p>
            </div>
          ) : (
            <StaggerContainer className="space-y-3">
              {checklist.map((item) => (
                <StaggerItem key={item.id}>
                  <div className="rounded-xl bg-card p-4 shadow-sm border border-border">
                    <div className="flex items-center justify-between gap-4">
                      <p className="flex-1 font-medium text-foreground">{item.question}</p>
                      <div className="flex gap-2">
                        <Button
                          onClick={() => updateStatus(item.id, "pass")}
                          variant={item.status === "pass" ? "default" : "outline"}
                          className={cn("min-w-[72px]", item.status === "pass" && "bg-green-600 hover:bg-green-700")}
                        >
                          <CheckCircle className="h-5 w-5" />
                        </Button>
                        <Button
                          onClick={() => updateStatus(item.id, "fail")}
                          variant={item.status === "fail" ? "destructive" : "outline"}
                          className="min-w-[72px]"
                        >
                          <X className="h-5 w-5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </StaggerItem>
              ))}
            </StaggerContainer>
          )}
        </div>

        {/* Signature — show after checklist is complete */}
        <AnimatePresence>
          {allCompleted && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            >
              <SignaturePad
                onSave={setSignatureDataUrl}
                savedSignature={signatureDataUrl}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Submit Button */}
      <div className="sticky bottom-0 border-t border-border bg-card p-4 pb-safe">
        <Button
          onClick={handleSave}
          disabled={!readyToSubmit || isSubmitting || isSyncing || isAnalyzing}
          variant={readyToSubmit ? (hasFailures ? "destructive" : "default") : "secondary"}
          className="w-full gap-2 h-12 rounded-xl"
          size="lg"
        >
          {isSubmitting ? (
            <><Loader2 className="h-5 w-5 animate-spin" /> Saving...</>
          ) : !allCompleted ? (
            "Complete All Checklist Items"
          ) : !signatureDataUrl ? (
            "Add Signature to Submit"
          ) : (
            <><CheckCircle className="h-5 w-5" /> Sign &amp; Submit Inspection</>
          )}
        </Button>
      </div>

      {/* Corrective Action Modal */}
      {correctiveItem && submittedInspectionId && (
        <CorrectiveActionForm
          inspectionId={submittedInspectionId}
          checklistItemId={correctiveItem.id}
          questionText={correctiveItem.question}
          onClose={() => setCorrectiveItem(null)}
          onSubmitted={() => {
            setCorrectiveItem(null);
            toast.success("Corrective action submitted");
          }}
        />
      )}
    </div>
  );
}
