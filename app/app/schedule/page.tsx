'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/auth/AuthProvider';
import { CalendarClock, Loader2, CheckCircle, Clock, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Schedule {
  id: string;
  equipment_id: string;
  assigned_to: string | null;
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annually';
  next_due: string;
  last_completed: string | null;
  is_active: boolean;
  equipment?: { name: string; serial_number: string | null };
}

const frequencyLabels: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annually: 'Annually',
};

export default function SchedulePage() {
  const { organization } = useAuth();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchSchedules = useCallback(async () => {
    if (!organization) return;
    setIsLoading(true);
    const { data, error } = await supabase
      .from('schedules')
      .select('*, equipment(name, serial_number)')
      .eq('organization_id', organization.id)
      .order('next_due', { ascending: true });

    if (!error && data) setSchedules(data);
    setIsLoading(false);
  }, [organization]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (organization) fetchSchedules();
  }, [organization, fetchSchedules]);

  const now = useMemo(() => new Date(), []);

  const getDaysUntilDue = useCallback((dueDate: string) => {
    return Math.ceil((new Date(dueDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  }, [now]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold font-display text-foreground">Inspection Schedule</h1>
          <p className="text-muted-foreground">Recurring inspections and upcoming due dates</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading schedules...
        </div>
      ) : schedules.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <CalendarClock className="h-16 w-16 mb-4 opacity-20" />
          <p className="text-lg font-medium">No schedules yet</p>
          <p className="text-sm mb-4">Create equipment first, then set up recurring inspections</p>
        </div>
      ) : (
        <div className="space-y-3">
          {schedules.map((schedule) => {
            const days = getDaysUntilDue(schedule.next_due);
            const isOverdue = days < 0;
            const isDueSoon = days >= 0 && days <= 3;

            return (
              <div
                key={schedule.id}
                className={cn(
                  'rounded-xl border bg-card p-5 shadow-sm transition-all hover:shadow-card',
                  isOverdue && 'border-destructive/30 bg-destructive/5',
                  isDueSoon && !isOverdue && 'border-warning/30 bg-warning-bg'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      'flex h-11 w-11 items-center justify-center rounded-xl',
                      isOverdue ? 'bg-destructive/10 text-destructive' :
                      isDueSoon ? 'bg-warning/10 text-warning' :
                      'bg-primary/10 text-primary'
                    )}>
                      <Wrench className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">
                        {schedule.equipment?.name || 'Unknown Equipment'}
                      </h3>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {frequencyLabels[schedule.frequency]}
                        </span>
                        <span className={cn(
                          'font-medium',
                          isOverdue ? 'text-destructive' : isDueSoon ? 'text-warning' : 'text-foreground'
                        )}>
                          {isOverdue ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : `Due in ${days}d`}
                        </span>
                      </div>
                    </div>
                  </div>
                  {schedule.is_active && (
                    <span className="flex items-center gap-1 text-xs font-medium text-success">
                      <CheckCircle className="h-3.5 w-3.5" /> Active
                    </span>
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
