'use client';

import { useMemo } from 'react';
import { Wrench, Calendar, MapPin, AlertCircle, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Equipment {
  id: string;
  name: string;
  type: string | null;
  serial_number: string | null;
  location: string | null;
  status: 'active' | 'out_of_service' | 'retired';
  next_due_date: string | null;
  last_inspection_date: string | null;
  photo_url: string | null;
}

const statusConfig = {
  active: { label: 'Active', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', icon: CheckCircle },
  out_of_service: { label: 'Out of Service', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: AlertCircle },
  retired: { label: 'Retired', color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400', icon: Wrench },
};

export function EquipmentCard({ equipment, onClick }: { equipment: Equipment; onClick?: () => void }) {
  const status = statusConfig[equipment.status];
  const StatusIcon = status.icon;

  const daysUntilDue = useMemo(() => {
    if (!equipment.next_due_date) return null;
    const now = new Date();
    return Math.ceil((new Date(equipment.next_due_date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  }, [equipment.next_due_date]);

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-2xl border border-border bg-card p-5 shadow-sm hover:shadow-card transition-all duration-300 hover:-translate-y-0.5 group"
    >
      <div className="flex items-start gap-4">
        {/* Photo or placeholder */}
        <div className="h-16 w-16 shrink-0 rounded-xl bg-muted flex items-center justify-center overflow-hidden">
          {equipment.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={equipment.photo_url} alt={equipment.name} className="h-full w-full object-cover" />
          ) : (
            <Wrench className="h-7 w-7 text-muted-foreground/40" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-foreground truncate group-hover:text-primary transition-colors">
              {equipment.name}
            </h3>
            <span className={cn('inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-medium', status.color)}>
              <StatusIcon className="h-3 w-3" />
              {status.label}
            </span>
          </div>

          {equipment.serial_number && (
            <p className="text-xs text-muted-foreground font-mono">SN: {equipment.serial_number}</p>
          )}

          <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
            {equipment.location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" /> {equipment.location}
              </span>
            )}
            {daysUntilDue !== null && (
              <span className={cn('flex items-center gap-1', daysUntilDue <= 3 ? 'text-destructive font-medium' : daysUntilDue <= 7 ? 'text-warning' : '')}>
                <Calendar className="h-3 w-3" />
                {daysUntilDue <= 0 ? 'Overdue' : `Due in ${daysUntilDue}d`}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
