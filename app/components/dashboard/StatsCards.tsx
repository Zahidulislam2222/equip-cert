import { ClipboardCheck, AlertTriangle, ShieldCheck, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: { value: number; positive: boolean };
  variant?: "default" | "warning" | "success";
}

export function StatCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  variant = "default",
}: StatCardProps) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl bg-white p-6 shadow-sm border transition-all duration-300 hover:shadow-md animate-fade-in",
        // Fix: Map abstract colors to real Tailwind colors so they show up
        variant === "warning" && "border-l-4 border-yellow-500",
        variant === "success" && "border-l-4 border-green-500",
        variant === "default" && "border-l-4 border-blue-500" // Added for consistency
      )}
    >
      {/* Background decoration */}
      <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-gray-50 transition-transform duration-300 group-hover:scale-125" />

      <div className="relative flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className="text-3xl font-bold text-gray-900">{value}</p>
          {subtitle && (
            <p className="text-sm text-gray-400">{subtitle}</p>
          )}
          {trend && (
            <div
              className={cn(
                "inline-flex items-center gap-1 text-sm font-medium",
                trend.positive ? "text-green-600" : "text-red-600"
              )}
            >
              <TrendingUp
                className={cn("h-4 w-4", !trend.positive && "rotate-180")}
              />
              <span>
                {trend.positive ? "+" : "-"}
                {Math.abs(trend.value)}% this week
              </span>
            </div>
          )}
        </div>

        <div
          className={cn(
            "flex h-12 w-12 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110",
            // Fix: Real colors for the icons
            variant === "default" && "bg-blue-50 text-blue-600",
            variant === "warning" && "bg-yellow-50 text-yellow-600",
            variant === "success" && "bg-green-50 text-green-600"
          )}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

// FIX: Renamed from 'StatsOverview' to 'StatsCards' to match page.tsx import
export function StatsCards() {
  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      <StatCard
        title="Total Inspections"
        value={248}
        subtitle="This month"
        icon={<ClipboardCheck className="h-6 w-6" />}
        trend={{ value: 12, positive: true }}
      />
      <StatCard
        title="Failed Items"
        value={7}
        subtitle="Requires attention"
        icon={<AlertTriangle className="h-6 w-6" />}
        variant="warning"
        trend={{ value: 3, positive: false }}
      />
      <StatCard
        title="Safety Score"
        value="97.2%"
        subtitle="Fleet compliance"
        icon={<ShieldCheck className="h-6 w-6" />}
        variant="success"
        trend={{ value: 2.4, positive: true }}
      />
    </div>
  );
}