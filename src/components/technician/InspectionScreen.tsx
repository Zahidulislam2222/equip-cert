'use client';

import { dataUrlToBlob } from '@/lib/data-url';
import { useState, useEffect, useRef } from "react";
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
import { capturePhoto } from "@/lib/capture";
import { uploadEvidence } from "@/lib/evidence";
import type { InspectionInsert } from "@/lib/db";
import { useAuth } from "@/components/auth/AuthProvider";
import { GPSCapture } from "@/components/shared/GPSCapture";
import type { LocationData } from "@/components/shared/GPSCapture";
import { SignaturePad } from "@/components/shared/SignaturePad";
import { CorrectiveActionForm } from "@/components/corrective/CorrectiveActionForm";
import { queueSubmission } from "@/lib/offline";
import { AiDisclosurePanel } from "@/components/shared/AiDisclosure";
import { isAiProvenance, toProvenanceColumns, type AiProvenance } from "@/lib/compliance/ai-act";
import { supabase as supabaseClient } from "@/lib/supabase";
import { recordEsignConsent } from "@/lib/auth";
import esignConsent from "@/content/esign-consent.json";
import { toast } from "sonner";
import { canAccess } from "@/lib/plans";
import { pickChecklist, type CmsChecklistEntry } from "@/lib/checklists";

interface InspectionScreenProps {
  isAiMode: boolean;
  onBack: () => void;
  onComplete: () => void;
}

// A type alias rather than an interface, deliberately. `checklist_data` is a jsonb column, so
// the generated type is `Json`, whose object arm is an index signature. TypeScript treats a
// type alias as having an implicit index signature and an interface as not having one, so an
// `interface` here is rejected on assignment to Json even though the shape is identical.
type RegisteredEquipment = { id: string; name: string; type: string | null };

/** Select value for an asset that is not in the register yet (filed by name, unlinked). */
const UNREGISTERED = "__unregistered__";

type ChecklistItem = {
  id: string;
  question: string;
  status: "pending" | "pass" | "fail";
};

export function InspectionScreen({ isAiMode, onBack, onComplete }: InspectionScreenProps) {
  const { profile, organization } = useAuth();

  // State
  const [equipmentName, setEquipmentName] = useState<string>(isAiMode ? "Unknown Equipment" : "");
  // Manual mode inspects a REGISTERED asset, so the record links to it and the database can
  // advance its due dates (DEF-092). It used to file every manual inspection as a hard-coded
  // "Caterpillar X500" with no link to anything.
  const [registry, setRegistry] = useState<RegisteredEquipment[]>([]);
  const [equipmentId, setEquipmentId] = useState<string>("");
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [checklistBasis, setChecklistBasis] = useState<string>("");

  // Photo State
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);

  // GPS + Signature State
  const [location, setLocation] = useState<LocationData | null>(null);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);

  // Corrective actions are raised AFTER the inspection exists (they reference its id), one per
  // failed item. This used to open only if the screen was still mounted after submit — it never
  // was, so no corrective action could be raised from an inspection (DEF-093).
  const [pendingFailures, setPendingFailures] = useState<ChecklistItem[]>([]);
  const [submittedInspectionId, setSubmittedInspectionId] = useState<number | null>(null);

  // UI State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // AI Act Art. 50 provenance for this inspection. Null means no AI was involved,
  // which is a real state on the manual path — not a missing value.
  const [aiProvenance, setAiProvenance] = useState<AiProvenance | null>(null);

  // --- 1. CHECKLIST ---
  // The CMS checklist for the asset's type, else the built-in one for that type, else a general
  // one — never an unrelated checklist (src/lib/checklists.ts). Callers set isSyncing(true).
  // Only the newest request may set the checklist: pick asset A, then B, and A's slower response
  // must not land on B (fresh review 2026-11-25).
  const checklistRequest = useRef(0);
  const loadChecklist = async (terms: (string | null | undefined)[]) => {
    const request = ++checklistRequest.current;
    let entries: CmsChecklistEntry[] = [];
    try {
      const response = await contentfulClient.getEntries({ content_type: 'checklist', include: 2 });
      entries = response.items as unknown as CmsChecklistEntry[];
    } catch (error) {
      // The CMS being unreachable must not stop an inspection: the built-in checklists still apply.
      console.error("Contentful Error:", error);
    }
    if (request !== checklistRequest.current) return;
    const picked = pickChecklist(entries, terms);
    setChecklist(picked.questions.map((question, i) => ({ id: String(i + 1), question, status: "pending" as const })));
    setChecklistBasis(picked.basis);
    setIsSyncing(false);
  };

  // --- 2. INITIAL LOAD ---
  // Manual mode: load the organisation's active equipment register; the checklist loads once an
  // asset is chosen. `active` stops a load for an unmounted screen.
  useEffect(() => {
    if (isAiMode) return;
    let active = true;
    void supabase
      .from('equipment')
      .select('id, name, type')
      .eq('status', 'active')
      .order('name')
      .limit(500)
      .then(({ data }) => {
        if (active) setRegistry(data ?? []);
      });
    return () => {
      active = false;
    };
  }, [isAiMode]);

  const chooseEquipment = (value: string) => {
    setEquipmentId(value);
    const item = registry.find((e) => e.id === value);
    setEquipmentName(item ? item.name : "");
    setChecklist([]);
    setIsSyncing(true);
    // Chosen by the asset's type first (e.g. "Fire Extinguisher"), then its name.
    void loadChecklist(item ? [item.type, item.name] : []);
  };

  // --- 3. AI ANALYSIS ---
  const analyzeWithAI = async (blob: Blob) => {
    setIsAnalyzing(true);
    try {
      // Read the file BEFORE the request, inside this try: the request used to run in a
      // FileReader callback, so the spinner stopped immediately and failures were never caught.
      const base64data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result?.toString().split(',')[1] ?? '');
        reader.onerror = () => reject(reader.error ?? new Error('Could not read the photo.'));
        reader.readAsDataURL(blob);
      });
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

      if (!data.equipmentName) throw new Error("AI did not return equipment name.");
      // Validated, not cast — this crossed a network boundary. If the server ever stops
      // stamping provenance we record no AI claim rather than a fabricated one.
      if (isAiProvenance(data.provenance)) {
        setAiProvenance(data.provenance);
      }
      setEquipmentName(data.equipmentName);
      setIsSyncing(true);
      await loadChecklist([data.equipmentName]);
    } catch (error) {
      console.error("AI API Error:", error);
      toast.error("AI identification is unavailable right now. Use Manual mode instead.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // --- 4. CAMERA ---
  const takePhoto = async () => {
    const photo = await capturePhoto();
    if (!photo) return; // cancelled

    // Release the previous preview before replacing it, or each retake leaks a blob.
    setPhotoUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return photo.objectUrl;
    });
    setPhotoBlob(photo.blob);

    if (isAiMode && checklist.length === 0) {
      await analyzeWithAI(photo.blob);
    }
  };

  // --- 5. CHECKLIST ---
  const updateStatus = (id: string, status: "pass" | "fail") => {
    setChecklist((items) =>
      items.map((item) => (item.id === id ? { ...item, status } : item))
    );

  };

  const allCompleted = checklist.length > 0 && checklist.every((item) => item.status !== "pending");
  const hasFailures = checklist.some((item) => item.status === "fail");
  // Signatures are a paid-plan feature, enforced by the database (enforce_plan_limits rejects a
  // signature_url on the free plan). Requiring one on the free plan meant a free organisation could
  // not file a single inspection (DEF-079): free records are filed unsigned, and say so.
  const signaturesAllowed = canAccess(organization?.plan ?? 'free', 'signatures');
  const hasEquipment = equipmentName.trim().length > 0;
  const readyToSubmit = hasEquipment && allCompleted && (!signaturesAllowed || !!signatureDataUrl);

  /** Move to the next failed item's corrective action, or finish when none are left. */
  const nextFailure = () => {
    const rest = pendingFailures.slice(1);
    setPendingFailures(rest);
    if (rest.length === 0) onComplete();
  };

  // --- 6. SAVE ---
  const handleSave = async () => {
    setIsSubmitting(true);
    try {
      // Evidence goes to the private bucket and the record stores a PATH, never a URL
      // (DEF-017). Failure now throws instead of being swallowed: the old code did
      // `if (!uploadError) { ...set the url... }`, which quietly filed an inspection with no
      // photo attached and told nobody.
      const orgId = organization?.id;
      if (!orgId) throw new Error('No organization on this session; cannot file an inspection.');

      // Decoded locally: fetch() of a data: URL is blocked by the production CSP (connect-src).
      const sigBlob = signatureDataUrl ? dataUrlToBlob(signatureDataUrl) : null;
      const consentVersion = sigBlob ? esignConsent.version : null;
      const offline = !navigator.onLine;

      // Online: consent evidence is recorded BEFORE the signed record exists (DEF-074), then the
      // evidence is uploaded. Offline: nothing can be uploaded yet, so the raw evidence is queued
      // and the same three steps run at sync time (DEF-078 — uploading first made the queue
      // unreachable, because the upload threw before the offline branch).
      let uploadedImagePath: string | null = null;
      let uploadedSignaturePath: string | null = null;
      if (!offline) {
        if (consentVersion) await recordEsignConsent(consentVersion);
        if (photoBlob) uploadedImagePath = await uploadEvidence('inspection', orgId, photoBlob);
        if (sigBlob) uploadedSignaturePath = await uploadEvidence('signature', orgId, sigBlob);
      }

      const payload: InspectionInsert = {
        equipment_name: equipmentName.trim(),
        equipment_id: equipmentId && equipmentId !== UNREGISTERED ? equipmentId : null,
        // The inspector of record is always the human who signed. Naming the AI here would
        // put a machine on a safety document as the responsible inspector, which NFPA 10
        // and OSHA 1910.157 both require to be a qualified person. AI involvement is
        // recorded in the ai_* provenance columns, which is where it belongs.
        inspector_name: profile?.full_name || "Unknown",
        inspector_id: profile?.id || null,
        organization_id: orgId,
        checklist_data: checklist,
        status: hasFailures ? "Action Required" : "Safe",
        // AI Act Art. 50 provenance. The database CHECK `ai_provenance_is_complete` rejects a
        // half-filled set, so this spreads all four columns together or all four as null.
        ...toProvenanceColumns(aiProvenance),
        photo_url: uploadedImagePath,
        signature_url: uploadedSignaturePath,
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

      if (offline) {
        // Queue for offline sync — evidence travels as blobs and is uploaded by the sync.
        await queueSubmission({
          payload,
          photoBlob,
          signatureBlob: sigBlob,
          esignConsentVersion: consentVersion,
          timestamp: Date.now(),
        });
        toast.info(
          hasFailures
            ? "Saved offline — will sync when back online. Report the failed items from Corrective Actions once it has synced."
            : "Saved offline — will sync when back online"
        );
        onComplete();
        return;
      }

      const { data, error } = await supabase.from('inspections').insert([payload]).select('id').single();

      if (error) throw error;

      toast.success("Inspection submitted successfully");
      const failed = checklist.filter((item) => item.status === "fail");
      if (data?.id && failed.length > 0) {
        // Stay on this screen: each failed item gets its corrective action, then we finish.
        setSubmittedInspectionId(data.id);
        setPendingFailures(failed);
        return;
      }
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
        <button onClick={onBack} aria-label="Back" className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted active:scale-95">
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

        {!isAiMode && (
          <div className="space-y-2">
            <label htmlFor="inspect-equipment" className="text-sm font-medium text-foreground">
              Equipment
            </label>
            <select
              id="inspect-equipment"
              value={equipmentId}
              onChange={(e) => chooseEquipment(e.target.value)}
              className="w-full rounded-lg border border-input bg-card px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="" disabled>
                {registry.length ? "Choose the equipment you are inspecting" : "No equipment registered yet"}
              </option>
              {registry.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.type ? `${e.name} — ${e.type}` : e.name}
                </option>
              ))}
              <option value={UNREGISTERED}>Not in the register (type its name)</option>
            </select>
            {equipmentId === UNREGISTERED && (
              <input
                aria-label="Equipment name"
                value={equipmentName}
                onChange={(e) => setEquipmentName(e.target.value)}
                maxLength={200}
                placeholder="Equipment name"
                className="w-full rounded-lg border border-input bg-card px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            )}
          </div>
        )}

        {/* Photo / Scan UI */}
        <FadeInView>
          <div className={cn("relative overflow-hidden rounded-lg border-2 border-dashed transition-all duration-300",
            photoUrl ? "border-success bg-success-bg" : "border-muted-foreground/30 bg-muted/50",
            isAiMode && !photoUrl && "border-primary/40 bg-primary-light"
          )}>
            <div className="relative flex aspect-video items-center justify-center">
              {!photoUrl ? (
                <Button onClick={takePhoto} variant={isAiMode ? "default" : "outline"} className={cn("gap-3", isAiMode && "h-16 px-8 rounded-full shadow-card")}>
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
                        <div className="flex flex-col items-center gap-3 bg-white/90 p-4 rounded-lg shadow-xl">
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

        {/* AI Act Art. 50(1) disclosure. Rendered whenever an automated system produced any
            of the content below, before the checklist the technician is about to rely on and
            sign. Not dismissible, not animated in — see AiDisclosure.tsx. */}
        {aiProvenance && <AiDisclosurePanel provenance={aiProvenance} />}

        {/* Checklist */}
        <div className="space-y-3">
          {isSyncing ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Fetching Safety Rules...
            </div>
          ) : !isAiMode && !equipmentId ? (
            <p className="py-8 text-center text-muted-foreground">Choose the equipment to load its checklist.</p>
          ) : checklist.length === 0 && isAiMode && !photoUrl ? (
            <div className="text-center py-8 px-4 text-muted-foreground">
              <Sparkles className="mx-auto h-12 w-12 text-primary/20 mb-4" />
              <p>Take a photo of the equipment.</p>
              <p className="text-sm">The AI will identify it and load the correct checklist.</p>
            </div>
          ) : (
            <StaggerContainer className="space-y-3">
              {checklistBasis && checklist.length > 0 && (
                <p className="text-xs text-muted-foreground">Checklist: {checklistBasis}</p>
              )}
              {checklist.map((item) => (
                <StaggerItem key={item.id}>
                  <div className="rounded-lg bg-card p-4 shadow-sm border border-border">
                    <div className="flex items-center justify-between gap-4">
                      <p className="flex-1 font-medium text-foreground">{item.question}</p>
                      <div className="flex gap-2">
                        <Button
                          onClick={() => updateStatus(item.id, "pass")}
                          aria-label={`Pass: ${item.question}`}
                          aria-pressed={item.status === "pass"}
                          variant={item.status === "pass" ? "default" : "outline"}
                          className={cn("min-w-[72px]", item.status === "pass" && "bg-green-600 hover:bg-green-700")}
                        >
                          <CheckCircle className="h-5 w-5" />
                        </Button>
                        <Button
                          onClick={() => updateStatus(item.id, "fail")}
                          aria-label={`Fail: ${item.question}`}
                          aria-pressed={item.status === "fail"}
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
          {allCompleted && !signaturesAllowed && (
            <p className="rounded-lg border border-border bg-muted p-4 text-sm text-muted-foreground">
              Electronic signatures are part of the Pro plan. On your current plan this inspection is filed
              unsigned; an administrator can upgrade in Settings.
            </p>
          )}
          {allCompleted && signaturesAllowed && (
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
          // Filed already (the corrective-action dialog is open): a second press would file a second,
          // immutable record (fresh review 2026-11-25).
          disabled={!readyToSubmit || isSubmitting || isSyncing || isAnalyzing || submittedInspectionId !== null}
          variant={readyToSubmit ? (hasFailures ? "destructive" : "default") : "secondary"}
          className="w-full gap-2 h-12 rounded-lg"
          size="lg"
        >
          {isSubmitting ? (
            <><Loader2 className="h-5 w-5 animate-spin" /> Saving...</>
          ) : !hasEquipment ? (
            "Choose the Equipment"
          ) : !allCompleted ? (
            "Complete All Checklist Items"
          ) : signaturesAllowed && !signatureDataUrl ? (
            "Add Signature to Submit"
          ) : (
            <><CheckCircle className="h-5 w-5" /> {signaturesAllowed ? <>Sign &amp; Submit Inspection</> : 'Submit Inspection'}</>
          )}
        </Button>
      </div>

      {/* Corrective Action Modal */}
      {pendingFailures.length > 0 && submittedInspectionId && (
        <CorrectiveActionForm
          key={pendingFailures[0].id}
          inspectionId={submittedInspectionId}
          checklistItemId={pendingFailures[0].id}
          questionText={pendingFailures[0].question}
          onClose={() => nextFailure()}
          onSubmitted={() => {
            toast.success("Corrective action submitted");
            nextFailure();
          }}
        />
      )}
    </div>
  );
}
