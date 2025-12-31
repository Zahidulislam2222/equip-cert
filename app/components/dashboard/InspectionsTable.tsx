import { useEffect, useState } from "react";
import { FileText, ExternalLink, User, Calendar, Camera, Download, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { pdf } from "@react-pdf/renderer"; // <--- Import PDF generator
import { InspectionReportPDF } from "./InspectionReportPDF"; // <--- Import the PDF layout

// Define the shape of your Database Row
interface Inspection {
  id: number;
  equipment_name: string;
  inspector_name: string;
  created_at: string;
  status: string;
  photo_url: string | null;
  checklist_data: any[]; // <--- Added this field so we can print the questions in the PDF
}

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

  // --- PDF GENERATION LOGIC ---
  const generateAndDownloadPDF = async (inspection: Inspection) => {
    setDownloadingId(inspection.id);
    try {
      // 1. Generate the blob using react-pdf
      const blob = await pdf(<InspectionReportPDF data={inspection} />).toBlob();
      
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
    <div className="rounded-xl bg-card shadow-md animate-fade-in border">
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
          <tbody className="divide-y divide-border">
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
              inspections.map((inspection, index) => (
                <tr
                  key={inspection.id}
                  className="transition-colors hover:bg-muted/30"
                  style={{ animationDelay: `${index * 50}ms` }}
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
                            onClick={() => window.open(inspection.photo_url!, "_blank")}
                        >
                            <Camera className="h-4 w-4" />
                        </Button>
                        ) : (
                        <Button variant="ghost" size="sm" disabled className="text-gray-400">
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
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}