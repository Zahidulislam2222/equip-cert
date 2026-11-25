// Compliance reports — pure aggregation and CSV export (no I/O; unit-tested in unit/reports.test.mjs).
//
// The page reads rows under the caller's RLS and hands them here. Nothing in this file decides who
// may see what; it only counts what the database already allowed through.

export interface ReportInspection {
  id: number;
  created_at: string;
  status: 'Safe' | 'Action Required';
  equipment_name: string;
  inspector_name: string;
  ai_assisted: boolean;
  signature_url: string | null;
}

export interface ReportAction {
  status: 'open' | 'in_progress' | 'resolved' | 'overdue';
  severity: 'critical' | 'major' | 'minor';
  due_date: string | null;
}

export interface ReportEquipment {
  status: 'active' | 'out_of_service' | 'retired';
  next_due_date: string | null;
}

export interface ReportSummary {
  total: number;
  safe: number;
  actionRequired: number;
  /** Percentage 0..100 with one decimal, or null when there were no inspections. */
  passRate: number | null;
  signedPct: number | null;
  aiAssistedPct: number | null;
  openActions: Record<ReportAction['severity'], number>;
  overdueActions: number;
  overdueEquipment: number;
  byWeek: { weekStart: string; safe: number; actionRequired: number }[];
  byInspector: { name: string; total: number; actionRequired: number }[];
}

const pct = (part: number, whole: number) => (whole === 0 ? null : Math.round((part / whole) * 1000) / 10);

/** Monday of the ISO week containing `iso`, as YYYY-MM-DD (UTC). */
export function weekStart(iso: string): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export function summarize(
  inspections: ReportInspection[],
  actions: ReportAction[],
  equipment: ReportEquipment[],
  today: string
): ReportSummary {
  const total = inspections.length;
  const actionRequired = inspections.filter((i) => i.status === 'Action Required').length;
  const safe = total - actionRequired;

  const openActions: ReportSummary['openActions'] = { critical: 0, major: 0, minor: 0 };
  let overdueActions = 0;
  for (const a of actions) {
    if (a.status === 'resolved') continue;
    openActions[a.severity] += 1;
    if (a.status === 'overdue' || (a.due_date !== null && a.due_date < today)) overdueActions += 1;
  }

  const overdueEquipment = equipment.filter(
    (e) => e.status === 'active' && e.next_due_date !== null && e.next_due_date < today
  ).length;

  const weeks = new Map<string, { safe: number; actionRequired: number }>();
  const inspectors = new Map<string, { total: number; actionRequired: number }>();
  for (const i of inspections) {
    const w = weekStart(i.created_at);
    const bucket = weeks.get(w) ?? { safe: 0, actionRequired: 0 };
    if (i.status === 'Action Required') bucket.actionRequired += 1;
    else bucket.safe += 1;
    weeks.set(w, bucket);

    const who = inspectors.get(i.inspector_name) ?? { total: 0, actionRequired: 0 };
    who.total += 1;
    if (i.status === 'Action Required') who.actionRequired += 1;
    inspectors.set(i.inspector_name, who);
  }

  return {
    total,
    safe,
    actionRequired,
    passRate: pct(safe, total),
    signedPct: pct(inspections.filter((i) => i.signature_url !== null).length, total),
    aiAssistedPct: pct(inspections.filter((i) => i.ai_assisted).length, total),
    openActions,
    overdueActions,
    overdueEquipment,
    byWeek: [...weeks.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, v]) => ({ weekStart, ...v })),
    byInspector: [...inspectors.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
  };
}

/**
 * One CSV cell. Quotes always (RFC 4180), doubles embedded quotes, and neutralises formula
 * injection: a cell a spreadsheet would evaluate (=, +, -, @, tab, CR) is prefixed with an
 * apostrophe. Equipment and inspector names are user-entered — an equipment named
 * `=HYPERLINK(...)` must open in Excel as text, not as a link (OWASP CSV injection).
 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function inspectionsToCsv(rows: ReportInspection[]): string {
  const header = ['Inspection ID', 'Date (UTC)', 'Equipment', 'Inspector', 'Result', 'Signed', 'AI-assisted'];
  const lines = rows.map((r) =>
    [r.id, r.created_at, r.equipment_name, r.inspector_name, r.status, r.signature_url ? 'yes' : 'no', r.ai_assisted ? 'yes' : 'no']
      .map(csvCell)
      .join(',')
  );
  // CRLF per RFC 4180; a BOM so Excel opens UTF-8 names correctly.
  return '﻿' + [header.map(csvCell).join(','), ...lines].join('\r\n') + '\r\n';
}
