'use client';

// Admin queue for data subject requests.
//
// The intake form starts a statutory clock. Without this screen that clock runs in a table
// nobody looks at, which is a worse position than having no form at all: a documented deadline
// you demonstrably missed is evidence against you, where an undocumented one is merely a gap.
//
// AUTHORIZATION IS NOT IN THIS FILE. `dsr_select_admin` and `dsr_update_admin` restrict every
// row to admins of the owning tenant, in Postgres, on every query. The `role === 'admin'` check
// below hides a card; it does not protect data. If the two ever disagree the database wins,
// which is the only arrangement where a client-side bug is a cosmetic bug (DEF-020: RLS decides
// rows, never columns — hiding a control is not the same as forbidding the write).

import { useCallback, useEffect, useState } from 'react';
import { Scale, AlertTriangle, Clock, CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth/AuthProvider';
import { privacyRequestCopy as copy } from '@/lib/compliance/privacy-requests';
import type { Database } from '@/lib/database.types';

// Derived from the generated schema types, never hand-written. A hand-written row shape drifts
// from the table the moment a migration lands, and drifts silently — the compiler has nothing
// to compare it against.
type DsarRow = Pick<
  Database['public']['Tables']['data_subject_requests']['Row'],
  | 'id'
  | 'subject_email'
  | 'request_type'
  | 'regime'
  | 'status'
  | 'received_at'
  | 'due_at'
  | 'subject_message'
  | 'source'
>;
type DsarStatus = Database['public']['Enums']['dsr_status'];

const OPEN_STATUSES: DsarStatus[] = ['received', 'identity_pending', 'in_progress', 'extended'];

const TYPE_LABEL = new Map(copy.requestTypes.map((t) => [t.value, t.label]));

/** Whole days from now until `iso`. Negative means overdue. */
function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.floor(ms / 86_400_000);
}

export function PrivacyRequestQueue() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<DsarRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: queryError } = await supabase
      .from('data_subject_requests')
      .select(
        'id, subject_email, request_type, regime, status, received_at, due_at, subject_message, source',
      )
      .in('status', OPEN_STATUSES)
      // Soonest deadline first. A queue sorted by arrival time buries the one that is overdue.
      .order('due_at', { ascending: true })
      .limit(50);

    if (queryError) setError(queryError.message);
    else setRows(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // The rule's own guidance permits exactly this shape: "subscribe for updates from some
    // external system, calling setState in a callback". `load` awaits the database before it
    // touches state, so nothing is set synchronously and no cascade is possible — the linter
    // simply cannot see past the useCallback to know that. Same disable convention as
    // ThemeToggle and ConsentControls, with the reason written down rather than assumed.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (profile?.role !== 'admin') return null;

  async function advance(id: string, status: DsarStatus) {
    setBusyId(id);
    setError(null);
    // `handled_by` and `completed_at` are stamped by the stamp_dsr_handler trigger, not sent
    // from here. A client-supplied completion date on a statutory deadline is a date somebody
    // chose, and this is precisely the record where that matters.
    const { error: updateError } = await supabase
      .from('data_subject_requests')
      .update({ status })
      .eq('id', id);

    if (updateError) setError(updateError.message);
    else await load();
    setBusyId(null);
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6 shadow-card">
      <div className="mb-4 flex items-center gap-2">
        <Scale className="h-5 w-5 text-primary" aria-hidden="true" />
        <h3 className="font-display text-lg font-semibold text-foreground">{copy.admin.title}</h3>
      </div>

      {loading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading…
        </p>
      )}

      {error && (
        <p className="mb-4 text-sm font-medium text-destructive" role="alert">
          {error}
        </p>
      )}

      {!loading && rows.length === 0 && (
        <div className="space-y-1">
          <p className="text-sm text-foreground">{copy.admin.empty}</p>
          <p className="text-xs text-muted-foreground">{copy.admin.emptyHint}</p>
        </div>
      )}

      <ul className="space-y-3">
        {rows.map((row) => {
          const days = daysUntil(row.due_at);
          const overdue = days < 0;
          const urgent = days >= 0 && days <= 3;

          return (
            <li
              key={row.id}
              className={`rounded-lg border p-4 ${
                overdue
                  ? 'border-destructive/50 bg-destructive/5'
                  : urgent
                    ? 'border-warning/50 bg-warning/5'
                    : 'border-border bg-background'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {TYPE_LABEL.get(row.request_type) ?? row.request_type}
                  </p>
                  {/* The address is the only identifier we have for an unauthenticated
                      requester, so it has to be visible to the admin who must reply to it. */}
                  <p className="truncate text-xs text-muted-foreground">{row.subject_email}</p>
                </div>

                <span
                  className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${
                    overdue
                      ? 'bg-destructive/15 text-destructive'
                      : urgent
                        ? 'bg-warning/15 text-warning'
                        : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {overdue ? (
                    <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                  ) : (
                    <Clock className="h-3 w-3" aria-hidden="true" />
                  )}
                  {overdue
                    ? `${copy.admin.overdueLabel} by ${Math.abs(days)}d`
                    : days === 0
                      ? copy.admin.dueTodayLabel
                      : `${days}d left`}
                </span>
              </div>

              {row.subject_message && (
                // Free text written by an unauthenticated caller. React escapes it on render;
                // it is never passed to dangerouslySetInnerHTML, and the database caps it at
                // 2000 characters so a long paste cannot bury the queue.
                <p className="mt-3 whitespace-pre-wrap break-words rounded border border-border bg-muted/40 p-2 text-xs text-foreground">
                  {row.subject_message}
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {row.status.replace(/_/g, ' ')}
                </span>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-xs text-muted-foreground">
                  {row.regime === 'gdpr' ? 'GDPR · 1 month' : 'US state · 45 days'}
                </span>

                <div className="ml-auto flex gap-2">
                  {row.status === 'received' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === row.id}
                      onClick={() => advance(row.id, 'identity_pending')}
                    >
                      Request ID
                    </Button>
                  )}
                  {row.status !== 'in_progress' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === row.id}
                      onClick={() => advance(row.id, 'in_progress')}
                    >
                      Start
                    </Button>
                  )}
                  <Button
                    size="sm"
                    disabled={busyId === row.id}
                    onClick={() => advance(row.id, 'completed')}
                  >
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    Complete
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
        {copy.admin.verifyPrompt} {copy.admin.refusalPrompt}
      </p>
    </div>
  );
}
