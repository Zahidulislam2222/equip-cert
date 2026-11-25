'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, Download, Loader2 } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { MotionPage } from '@/components/motion/MotionPage';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth/AuthProvider';
import { supabaseRead } from '@/lib/supabase';
import { config } from '@/lib/config';
import {
  inspectionsToCsv,
  summarize,
  type ReportAction,
  type ReportEquipment,
  type ReportInspection,
} from '@/lib/reports';

const RANGES = [30, 90, 365] as const;

interface ReportData {
  inspections: ReportInspection[];
  actions: ReportAction[];
  equipment: ReportEquipment[];
  truncated: boolean;
}

async function loadReport(organizationId: string, days: number): Promise<ReportData> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const max = config.reports.maxRows;
  // Aggregates tolerate replica lag, so they read through the read client (primary if no replica).
  const [ins, act, eq] = await Promise.all([
    supabaseRead
      .from('inspections')
      .select('id, created_at, status, equipment_name, inspector_name, ai_assisted, signature_url')
      .eq('organization_id', organizationId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(max + 1),
    supabaseRead
      .from('corrective_actions')
      .select('status, severity, due_date')
      .eq('organization_id', organizationId)
      .limit(max),
    supabaseRead.from('equipment').select('status, next_due_date').eq('organization_id', organizationId).limit(max),
  ]);
  for (const r of [ins, act, eq]) if (r.error) throw r.error;
  const rows = (ins.data ?? []) as ReportInspection[];
  return {
    inspections: rows.slice(0, max),
    actions: (act.data ?? []) as ReportAction[],
    equipment: (eq.data ?? []) as ReportEquipment[],
    truncated: rows.length > max,
  };
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-card">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-step-2 font-bold font-display text-foreground">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

const fmtPct = (v: number | null) => (v === null ? '—' : `${v}%`);

export default function ReportsPage() {
  const { organization } = useAuth();
  const [days, setDays] = useState<number>(config.reports.defaultRangeDays);
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const orgId = organization?.id ?? null;

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    loadReport(orgId, days)
      .then((d) => {
        if (!active) return;
        setData(d);
        setError(null);
      })
      .catch((err) => active && setError(err instanceof Error ? err.message : 'Could not load the report.'));
    return () => {
      active = false;
    };
  }, [orgId, days]);

  const today = new Date().toISOString().slice(0, 10);
  const summary = useMemo(
    () => (data ? summarize(data.inspections, data.actions, data.equipment, today) : null),
    [data, today]
  );

  const download = () => {
    if (!data) return;
    const blob = new Blob([inspectionsToCsv(data.inspections)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inspections-last-${days}-days-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <MotionPage className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-step-3 font-extrabold font-display text-foreground">Reports</h1>
          <p className="text-muted-foreground">Inspection results, open findings and overdue equipment.</p>
        </div>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="Report period" className="flex rounded-lg border border-border bg-card p-1">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={days === r}
                onClick={() => setDays(r)}
                className={`min-h-10 rounded-md px-3 text-sm font-medium ${days === r ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {r} days
              </button>
            ))}
          </div>
          <Button variant="outline" onClick={download} disabled={!data || data.inspections.length === 0} className="h-12">
            <Download className="h-4 w-4" aria-hidden /> CSV
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-foreground">{error}</p>
      )}

      {!summary && !error && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Building report…
        </div>
      )}

      {data?.truncated && (
        <p className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
          <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
          Showing the newest {config.reports.maxRows.toLocaleString()} inspections only. Choose a shorter period for a complete report.
        </p>
      )}

      {summary && summary.total === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card py-16 text-muted-foreground">
          <BarChart3 className="mb-3 h-12 w-12 opacity-40" aria-hidden />
          <p className="font-medium text-foreground">No inspections in the last {days} days</p>
          <p className="text-sm">Results appear here as soon as inspections are filed.</p>
        </div>
      )}

      {summary && summary.total > 0 && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Inspections" value={summary.total.toLocaleString()} hint={`${summary.actionRequired} needed action`} />
            <Stat label="Pass rate" value={fmtPct(summary.passRate)} />
            <Stat label="Signed" value={fmtPct(summary.signedPct)} hint="Records with an e-signature" />
            <Stat label="AI-assisted" value={fmtPct(summary.aiAssistedPct)} hint="EU AI Act Art. 50 provenance" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Stat
              label="Open corrective actions"
              value={(summary.openActions.critical + summary.openActions.major + summary.openActions.minor).toString()}
              hint={`${summary.openActions.critical} critical · ${summary.openActions.major} major · ${summary.openActions.minor} minor`}
            />
            <Stat label="Overdue corrective actions" value={summary.overdueActions.toString()} />
            <Stat label="Equipment overdue for inspection" value={summary.overdueEquipment.toString()} />
          </div>

          <section aria-labelledby="trend-heading" className="rounded-lg border border-border bg-card p-6 shadow-card">
            <h2 id="trend-heading" className="mb-4 text-lg font-semibold font-display text-foreground">Results by week</h2>
            <div className="h-72" aria-hidden>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={summary.byWeek}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="weekStart" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis allowDecimals={false} stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <Tooltip
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                  />
                  <Legend />
                  <Bar dataKey="safe" name="Safe" stackId="r" fill="hsl(var(--success))" />
                  <Bar dataKey="actionRequired" name="Action required" stackId="r" fill="hsl(var(--destructive))" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {/* The chart is decorative for assistive tech; this table carries the same numbers. */}
            <table className="sr-only">
              <caption>Inspection results by week</caption>
              <thead>
                <tr><th>Week starting</th><th>Safe</th><th>Action required</th></tr>
              </thead>
              <tbody>
                {summary.byWeek.map((w) => (
                  <tr key={w.weekStart}><td>{w.weekStart}</td><td>{w.safe}</td><td>{w.actionRequired}</td></tr>
                ))}
              </tbody>
            </table>
          </section>

          <section aria-labelledby="inspector-heading" className="rounded-lg border border-border bg-card shadow-card">
            <h2 id="inspector-heading" className="border-b border-border p-6 text-lg font-semibold font-display text-foreground">
              By inspector
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-6 py-3 font-medium">Inspector</th>
                    <th scope="col" className="px-6 py-3 font-medium">Inspections</th>
                    <th scope="col" className="px-6 py-3 font-medium">Action required</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {summary.byInspector.map((row) => (
                    <tr key={row.name}>
                      <td className="px-6 py-3 text-foreground">{row.name}</td>
                      <td className="px-6 py-3 text-foreground">{row.total}</td>
                      <td className="px-6 py-3 text-foreground">{row.actionRequired}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </MotionPage>
  );
}
