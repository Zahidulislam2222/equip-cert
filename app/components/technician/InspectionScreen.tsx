import { useState, useEffect } from "react";
import {
  ArrowLeft,
  Camera,
  CheckCircle,
  X,
  Pen,
  Loader2,
  Sparkles, // AI Icon
  ScanEye   // Scan Icon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase"; 
import { contentfulClient } from "@/lib/contentful"; 
import { Camera as CapCamera, CameraResultType } from "@capacitor/camera"; 

interface InspectionScreenProps {
  isAiMode: boolean; // <--- New Prop
  onBack: () => void;
  onComplete: () => void;
}

interface ChecklistItem {
  id: string;
  question: string;
  status: "pending" | "pass" | "fail";
}

export function InspectionScreen({ isAiMode, onBack, onComplete }: InspectionScreenProps) {
  // State
  const [equipmentName, setEquipmentName] = useState<string>(isAiMode ? "Unknown Equipment" : "Caterpillar X500");
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  
  // Photo State
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  
  // UI State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(!isAiMode); // Manual mode syncs immediately
  const [isAnalyzing, setIsAnalyzing] = useState(false); // AI Loading state

  // --- 1. FETCH FROM CONTENTFUL (Fixed TypeScript Error) ---
  const fetchChecklistFromContentful = async (nameToSearch: string) => {
    setIsSyncing(true);
    try {
      console.log(`🔌 Contentful: Searching for checklist for '${nameToSearch}'...`);
      
      const response = await contentfulClient.getEntries({
        content_type: 'checklist', 
        include: 2, 
      });

      if (response.items.length > 0) {
        // SMART FILTER: Find the checklist where the linked equipment name matches
        const matchingEntry = response.items.find((item: any) => {
          // FIX: We cast to 'any' here to stop the TypeScript error
          const linkedEntry = item.fields.equipmentType as any;
          const linkedName = linkedEntry?.fields?.name || "";
          
          return nameToSearch.toLowerCase().includes(linkedName.toLowerCase()) || 
                 linkedName.toLowerCase().includes(nameToSearch.toLowerCase());
        });

        const item = matchingEntry || response.items[0]; 
        
        if (matchingEntry) {
            // FIX: Another cast to 'any' for logging
            const entryName = (item.fields.equipmentType as any)?.fields?.name;
            console.log("✅ Match Found:", entryName);
        } else {
            console.warn("⚠️ No exact name match found. Using fallback.");
        }

        const rawData = item.fields.questions as any;
        const rawList = rawData ? (Array.isArray(rawData) ? rawData : rawData.questions || []) : [];

        if (rawList.length > 0) {
          const mappedItems = rawList.map((q: any, i: number) => ({
            id: (i + 1).toString(),
            question: q.text || q.question || "Unknown Question", 
            status: "pending" as "pending" 
          }));
          setChecklist(mappedItems);
        } else {
           setChecklist([{ id: "1", question: "Check General Condition", status: "pending" }]);
        }
      }
    } catch (error) {
      console.error("❌ Contentful Error:", error);
    } finally {
      setIsSyncing(false);
    }
  };

  // --- 2. INITIAL LOAD ---
  useEffect(() => {
    // If Manual Mode, load data immediately.
    // If AI Mode, do NOTHING (wait for scan).
    if (!isAiMode) {
      fetchChecklistFromContentful("Caterpillar X500");
    }
  }, [isAiMode]);

 // --- 3. AI ANALYSIS FUNCTION (Updated for Vercel) ---
 const analyzeWithAI = async (blob: Blob) => {
  setIsAnalyzing(true);
  try {
    // Convert Blob to Base64
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onloadend = async () => {
      const base64data = reader.result?.toString().split(',')[1]; // Remove the "data:image/jpeg;base64," part

      // Call your NEW Vercel API Route
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image: base64data,
          mimeType: blob.type
        }),
      });

      if (!response.ok) {
        throw new Error(`API failed with status ${response.status}`);
      }

      const data = await response.json();
      console.log("🤖 AI Response:", data);

      if (data.equipmentName) {
        setEquipmentName(data.equipmentName);
        await fetchChecklistFromContentful(data.equipmentName);
      } else {
        throw new Error("AI did not return equipment name.");
      }
    };

  } catch (error) {
    console.error("AI API Error:", error);
    alert("AI Service Unavailable. Check API Key.");
  } finally {
    setIsAnalyzing(false);
  }
};

  // --- 4. CAMERA LOGIC ---
  const takePhoto = async () => {
    try {
      const image = await CapCamera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Uri 
      });

      if (image.webPath) {
        setPhotoUrl(image.webPath);

        // Convert to Blob
        const response = await fetch(image.webPath);
        const blob = await response.blob();
        setPhotoBlob(blob);

        // ⚡️ MAGIC MOMENT: If in AI Mode and haven't analyzed yet, do it now!
        if (isAiMode && checklist.length === 0) {
          await analyzeWithAI(blob);
        }
      }
    } catch (error) {
      console.log("Camera cancelled:", error);
    }
  };

  const updateStatus = (id: string, status: "pass" | "fail") => {
    setChecklist((items) =>
      items.map((item) => (item.id === id ? { ...item, status } : item))
    );
  };

  const allCompleted = checklist.length > 0 && checklist.every((item) => item.status !== "pending");
  const hasFailures = checklist.some((item) => item.status === "fail");

  // --- 5. SAVE TO SUPABASE ---
  const handleSave = async () => {
    setIsSubmitting(true);
    try {
      let uploadedImageUrl = null;

      if (photoBlob) {
        const fileName = `inspection-${Date.now()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('photos')
          .upload(fileName, photoBlob);

        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage
          .from('photos')
          .getPublicUrl(fileName);
          
        uploadedImageUrl = publicUrlData.publicUrl;
      }

      const payload = {
        equipment_name: equipmentName, // Uses the AI-detected name
        inspector_name: isAiMode ? "AI Assistant" : "John Martinez",
        checklist_data: checklist,
        status: hasFailures ? "Action Required" : "Safe",
        created_at: new Date().toISOString(),
        photo_url: uploadedImageUrl
      };

      const { error } = await supabase.from('inspections').insert([payload]);

      if (error) throw error;
      onComplete();

    } catch (err: any) {
      console.error("Error:", err);
      alert(`Error: ${err.message}`);
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
          <h1 className="text-lg font-bold text-foreground">
            {isAnalyzing ? "Identifying..." : equipmentName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isAiMode ? (isAnalyzing ? "AI Vision Active" : "AI Mode") : "Manual Mode"}
          </p>
        </div>
        {isAiMode && (
           <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100">
             <Sparkles className="h-4 w-4 text-blue-600" />
           </div>
        )}
      </header>

      <main className="flex-1 overflow-auto px-4 py-6">
        
        {/* Photo / Scan UI */}
        <div className="mb-6 animate-fade-in">
          <div className={cn("relative overflow-hidden rounded-2xl border-2 border-dashed transition-all duration-300", 
            photoUrl ? "border-success bg-success-bg" : "border-muted-foreground/30 bg-muted/50",
            isAiMode && !photoUrl && "border-blue-400 bg-blue-50/50" // Blue style for AI prompt
          )}>
            <div className="relative flex aspect-video items-center justify-center">
              {!photoUrl ? (
                <Button onClick={takePhoto} variant={isAiMode ? "default" : "outline"} className={cn("gap-3", isAiMode && "h-16 px-8 rounded-full shadow-lg")}>
                  {isAiMode ? <ScanEye className="h-6 w-6" /> : <Camera className="h-6 w-6" />}
                  {isAiMode ? "Take Photo to Identify" : "Scan Equipment"}
                </Button>
              ) : (
                <div className="relative h-full w-full">
                  <img src={photoUrl} alt="Equipment" className="h-full w-full object-cover" />
                  
                  {/* AI Overlay */}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                     <div className="flex flex-col items-center gap-2">
                        {isAnalyzing ? (
                           <div className="flex flex-col items-center gap-3 bg-white/90 p-4 rounded-xl shadow-xl">
                             <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                             <p className="font-semibold text-blue-900">Analyzing...</p>
                           </div>
                        ) : (
                           <>
                             <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success">
                               <CheckCircle className="h-6 w-6 text-success-foreground" />
                             </div>
                             <p className="font-semibold text-white">
                               {isAiMode ? "Identified" : "Verified"}
                             </p>
                             <Button size="sm" variant="secondary" onClick={takePhoto}>Retake</Button>
                           </>
                        )}
                     </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Dynamic Questions List */}
        <div className="space-y-3">
          {isSyncing ? (
             <div className="flex items-center justify-center py-8 text-muted-foreground">
               <Loader2 className="mr-2 h-4 w-4 animate-spin" />
               Fetching Safety Rules...
             </div>
          ) : checklist.length === 0 && isAiMode && !photoUrl ? (
             <div className="text-center py-8 px-4 text-muted-foreground">
               <Sparkles className="mx-auto h-12 w-12 text-blue-200 mb-4" />
               <p>Take a photo of the equipment.</p>
               <p className="text-sm">The AI will identify it and load the correct checklist.</p>
             </div>
          ) : (
            checklist.map((item) => (
              <div key={item.id} className="rounded-xl bg-card p-4 shadow-sm border">
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
            ))
          )}
        </div>
      </main>

      <div className="sticky bottom-0 border-t border-border bg-card p-4 mobile-safe-area">
        <Button
          onClick={handleSave}
          disabled={!allCompleted || isSubmitting || isSyncing || isAnalyzing}
          variant={allCompleted ? (hasFailures ? "destructive" : "default") : "secondary"}
          className="w-full gap-2"
          size="lg"
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