import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ExternalLink, User, Calendar, Camera, Download, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import type { Inspection } from "@/lib/db";
import { signedEvidenceUrl } from "@/lib/evidence";
import { toast } from "sonner";
import { pdf } from "@react-pdf/renderer"; // <--- Import PDF generator
import { InspectionReportPDF } from "./InspectionReportPDF"; // <--- Import the PDF layout

const tableBodyVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.05 },
  },
};

const rowVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0 },
};

// Row shape from the generated schema; see src/lib/db.ts. checklist_data is jsonb, so it
// arrives as Json and is parsed at the point of use rather than assumed to be an array.
export function InspectionsTable() {
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<number | null>(null); // Track which row is downloading

  // --- FETCH REAL DATA FROM SUPABASE ---
  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data, error } = await supabase
          .from("inspections")
          .select("*")
          .order("created_at", { ascending: false }); // Newest first

        if (error) throw error;
        if (data) setInspections(data);
      } catch (err) {
        console.error("Error fetching inspections:", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  /**
   * Open one stored photo in a new tab.
   *
   * The window is opened synchronously and its location set afterwards. Awaiting the signed
   * URL first and *then* calling window.open would put the call outside the user-gesture
   * window, and every popup blocker would swallow it.
   */
  const openEvidence = (path: string) => {
    const tab = window.open('', '_blank', 'noopener,noreferrer');
    signedEvidenceUrl(path).then((url) => {
      if (!tab) return;
      if (url) {
        tab.location.href = url;
      } else {
        tab.close();
        toast.error('That photo could not be opened.');
      }
    });
  };

  // --- PDF GENERATION LOGIC ---
  const generateAndDownloadPDF = async (inspection: Inspection) => {
    setDownloadingId(inspection.id);
    try {
      // The record stores a private bucket path, and react-pdf fetches the image over the
      // network while rendering. Sign it first or the report renders with a missing image.
      const photoUrl = await signedEvidenceUrl(inspection.photo_url);

      // 1. Generate the blob using react-pdf
      const blob = await pdf(
        <InspectionReportPDF data={{ ...inspection, photo_url: photoUrl }} />
      ).toBlob();
      
      // 2. Create a hidden download link and click it
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Report-${inspection.equipment_name}-${inspection.id}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
    } catch (error) {
      console.error("PDF Error:", error);
      alert("Failed to generate PDF");
    } finally {
      setDownloadingId(null);
    }
  };

  // Helper to format date nicely (e.g., "Dec 31, 2025")
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ type: 'spring', stiffness: 260, damping: 30 }}
      className="rounded-lg bg-card shadow-md border"
    >
      <div className="flex items-center justify-between border-b border-border p-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Recent Inspections
          </h2>
          <p className="text-sm text-muted-foreground">
            Latest equipment safety checks
          </p>
        </div>
        {/* Refresh Button */}
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          Refresh Data
          <ExternalLink className="ml-2 h-4 w-4" />
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Equipment
              </th>
              <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Technician
              </th>
              <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Date
              </th>
              <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Status
              </th>
              <th className="px-6 py-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <motion.tbody
            className="divide-y divide-border"
            variants={tableBodyVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: '-40px' }}
          >
            {isLoading ? (
              // Simple Loading State
              <tr>
                <td colSpan={5} className="p-8 text-center text-muted-foreground">
                  Loading live data...
                </td>
              </tr>
            ) : inspections.length === 0 ? (
              // Empty State
              <tr>
                <td colSpan={5} className="p-8 text-center text-muted-foreground">
                  No inspections found. Use the Technician App to create one.
                </td>
              </tr>
            ) : (
              // Real Data Mapping
              inspections.map((inspection) => (
                <motion.tr
                  key={inspection.id}
                  variants={rowVariants}
                  className="transition-colors hover:bg-muted/30"
                >
                  <td className="px-6 py-4">
                    <span className="font-medium text-foreground">
                      {inspection.equipment_name}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <User className="h-4 w-4" />
                      </div>
                      <span className="text-foreground">
                        {inspection.inspector_name}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Calendar className="h-4 w-4" />
                      {formatDate(inspection.created_at)}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {inspection.status === "Safe" ? (
                      <Badge variant="success">Safe</Badge>
                    ) : (
                      <Badge variant="destructive">Action Required</Badge>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex gap-2">
                        {/* 1. View Photo Button */}
                        {inspection.photo_url ? (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                            onClick={() => openEvidence(inspection.photo_url!)}
                            aria-label={`View inspection photo for ${inspection.equipment_name}`}
                        >
                            <Camera className="h-4 w-4" />
                        </Button>
                        ) : (
                        <Button variant="ghost" size="sm" disabled className="text-muted-foreground">
                            <Camera className="h-4 w-4 opacity-50" />
                        </Button>
                        )}

                        {/* 2. Download PDF Button */}
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                            onClick={() => generateAndDownloadPDF(inspection)}
                            disabled={downloadingId === inspection.id}
                        >
                            {downloadingId === inspection.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Download className="h-4 w-4" />
                            )}
                            <span className="ml-2 hidden lg:inline">Report</span>
                        </Button>
                    </div>
                  </td>
                </motion.tr>
              ))
            )}
          </motion.tbody>
        </table>
      </div>
    </motion.div>
  );
}