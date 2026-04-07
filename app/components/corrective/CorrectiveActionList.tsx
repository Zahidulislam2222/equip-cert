'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle, Clock, Loader2, User } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CorrectiveAction {
  id: string;
  inspection_id: number;
  checklist_item_id: string;
  description: string;
  severity: 'critical' | 'major' | 'minor';
  assigned_to: string | null;
  due_date: string | null;
  status: 'open' | 'in_progress' | 'resolved' | 'overdue';
  resolution_notes: string | null;
  created_at: string;
}

const severityColors: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  major: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  minor: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
};

const statusConfig: Record<string, { icon: typeof AlertTriangle; color: string; label: string }> = {
  open: { icon: AlertTriangle, color: 'text-red-500', label: 'Open' },
  in_progress: { icon: Clock, color: 'text-amber-500', label: 'In Progress' },
  resolved: { icon: CheckCircle, color: 'text-green-500', label: 'Resolved' },
  overdue: { icon: AlertTriangle, color: 'text-red-600', label: 'Overdue' },
};

export function CorrectiveActionList() {
  const { organization } = useAuth();
  const [actions, setActions] = useState<CorrectiveAction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    fetchActions();
  }, [organization]);

  const fetchActions = async () => {
    if (!organization) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('corrective_actions')
        .select('*')
        .eq('organization_id', organization.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      if (data) setActions(data);
    } catch (err) {
      console.error('Error fetching corrective actions:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const updateStatus = async (id: string, newStatus: string) => {
    const { error } = await supabase
      .from('corrective_actions')
      .update({
        status: newStatus,
        ...(newStatus === 'resolved' ? { resolved_at: new Date().toISOString() } : {}),
      })
      .eq('id', id);

    if (!error) fetchActions();
  };

  const filtered = filter === 'all' ? actions : actions.filter((a) => a.status === filter);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {['all', 'open', 'in_progress', 'resolved'].map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? 'default' : 'outline'}
            onClick={() => setFilter(f)}
            className="rounded-lg capitalize whitespace-nowrap"
          >
            {f === 'all' ? 'All' : f.replace('_', ' ')}
            {f !== 'all' && (
              <span className="ml-1.5 text-xs opacity-70">
                ({actions.filter((a) => a.status === f).length})
              </span>
            )}
          </Button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <CheckCircle className="mx-auto h-12 w-12 opacity-20 mb-3" />
          <p className="font-medium">No corrective actions</p>
          <p className="text-sm">All clear — no issues found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((action) => {
            const statusInfo = statusConfig[action.status] || statusConfig.open;
            const StatusIcon = statusInfo.icon;

            return (
              <div
                key={action.id}
                className="rounded-xl border border-border bg-card p-4 shadow-sm hover:shadow-card transition-shadow"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={cn('inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium', severityColors[action.severity])}>
                        {action.severity}
                      </span>
                      <span className={cn('flex items-center gap-1 text-xs font-medium', statusInfo.color)}>
                        <StatusIcon className="h-3 w-3" />
                        {statusInfo.label}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-foreground">{action.description}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(action.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      {action.due_date && ` • Due: ${new Date(action.due_date).toLocaleDateString()}`}
                    </p>
                  </div>

                  {action.status !== 'resolved' && (
                    <div className="flex gap-2 shrink-0">
                      {action.status === 'open' && (
                        <Button size="sm" variant="outline" onClick={() => updateStatus(action.id, 'in_progress')} className="rounded-lg text-xs">
                          Start
                        </Button>
                      )}
                      <Button size="sm" onClick={() => updateStatus(action.id, 'resolved')} className="rounded-lg text-xs">
                        Resolve
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
