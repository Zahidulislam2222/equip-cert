import { FileText, ExternalLink, User, Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Inspection {
  id: string;
  equipmentName: string;
  technician: string;
  date: string;
  status: "safe" | "action-required";
}

const mockInspections: Inspection[] = [
  {
    id: "1",
    equipmentName: "Caterpillar X500",
    technician: "John Martinez",
    date: "Dec 29, 2025",
    status: "safe",
  },
  {
    id: "2",
    equipmentName: "Komatsu D65PX",
    technician: "Sarah Chen",
    date: "Dec 28, 2025",
    status: "action-required",
  },
  {
    id: "3",
    equipmentName: "Volvo EC950F",
    technician: "Mike Johnson",
    date: "Dec 28, 2025",
    status: "safe",
  },
  {
    id: "4",
    equipmentName: "John Deere 850L",
    technician: "Emily Davis",
    date: "Dec 27, 2025",
    status: "safe",
  },
  {
    id: "5",
    equipmentName: "Hitachi ZX350LC",
    technician: "Robert Wilson",
    date: "Dec 27, 2025",
    status: "action-required",
  },
  {
    id: "6",
    equipmentName: "Liebherr R 9200",
    technician: "John Martinez",
    date: "Dec 26, 2025",
    status: "safe",
  },
];

export function InspectionsTable() {
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
        <Button variant="outline" size="sm">
          View All
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
                Report
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {mockInspections.map((inspection, index) => (
              <tr
                key={inspection.id}
                className="transition-colors hover:bg-muted/30"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <td className="px-6 py-4">
                  <span className="font-medium text-foreground">
                    {inspection.equipmentName}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <User className="h-4 w-4" />
                    </div>
                    <span className="text-foreground">{inspection.technician}</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    {inspection.date}
                  </div>
                </td>
                <td className="px-6 py-4">
                  {inspection.status === "safe" ? (
                    <Badge variant="success">Safe</Badge>
                  ) : (
                    // FIX: Changed 'danger' to 'destructive' to match your config
                    <Badge variant="destructive">Action Required</Badge>
                  )}
                </td>
                <td className="px-6 py-4">
                  <Button variant="ghost" size="sm" className="gap-2">
                    <FileText className="h-4 w-4" />
                    View PDF
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}