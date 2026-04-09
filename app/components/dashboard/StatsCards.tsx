'use client';

import { useEffect, useState } from 'react';
import { ClipboardCheck, AlertTriangle, ShieldCheck, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/components/auth/AuthProvider';
import { StaggerContainer, StaggerItem } from '@/components/motion/StaggerGrid';
import { MotionCard } from '@/components/motion/MotionCard';
import { AnimatedCounter } from '@/components/motion/AnimatedCounter';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: { value: number; positive: boolean };
  variant?: 'default' | 'warning' | 'success';
  isLoading?: boolean;
}

function StatCard({ title, value, subtitle, icon, trend, variant = 'default', isLoading }: StatCardProps) {
  // Parse numeric value for AnimatedCounter
  const numericValue = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.]/g, ''));
  const isNumeric = !isNaN(numericValue);
  const suffix = typeof value === 'string' ? value.replace(/[0-9.]/g, '') : '';

  return (
    <StaggerItem>
      <MotionCard
        className={cn(
          'group relative overflow-hidden rounded-2xl bg-card p-6 shadow-card border',
          variant === 'warning' && 'border-l-4 border-l-warning',
          variant === 'success' && 'border-l-4 border-l-success',
          variant === 'default' && 'border-l-4 border-l-primary'
        )}
      >
        <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-muted/50 transition-transform duration-300 group-hover:scale-125" />

        <div className="relative flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            {isLoading ? (
              <div className="h-9 w-20 skeleton rounded-lg" />
            ) : isNumeric ? (
              <AnimatedCounter
                value={numericValue}
                suffix={suffix}
                className="text-3xl font-bold font-display text-foreground"
              />
            ) : (
              <p className="text-3xl font-bold font-display text-foreground">{value}</p>
            )}
            {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
            {trend && !isLoading && (
              <div className={cn(
                'inline-flex items-center gap-1 text-sm font-medium',
                trend.positive ? 'text-success' : 'text-destructive'
              )}>
                <TrendingUp className={cn('h-4 w-4', !trend.positive && 'rotate-180')} />
                <span>{trend.positive ? '+' : '-'}{Math.abs(trend.value)}% this week</span>
              </div>
            )}
          </div>

          <div className={cn(
            'flex h-12 w-12 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110',
            variant === 'default' && 'bg-primary/10 text-primary',
            variant === 'warning' && 'bg-warning/10 text-warning',
            variant === 'success' && 'bg-success/10 text-success'
          )}>
            {icon}
          </div>
        </div>
      </MotionCard>
    </StaggerItem>
  );
}

export function StatsCards() {
  const { organization } = useAuth();
  const [stats, setStats] = useState({ total: 0, failed: 0, safetyScore: '0' });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, [organization]);

  const fetchStats = async () => {
    setIsLoading(true);
    try {
      // Get inspections for the current month
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      let query = supabase
        .from('inspections')
        .select('status')
        .gte('created_at', startOfMonth.toISOString());

      if (organization) {
        query = query.eq('organization_id', organization.id);
      }

      const { data } = await query;

      const total = data?.length || 0;
      const failedCount = data?.filter((d) => d.status === 'Action Required').length || 0;
      const score = total > 0 ? (((total - failedCount) / total) * 100).toFixed(1) : '100';

      setStats({ total, failed: failedCount, safetyScore: score });
    } catch (err) {
      console.error('Stats error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <StaggerContainer className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      <StatCard
        title="Total Inspections"
        value={stats.total}
        subtitle="This month"
        icon={<ClipboardCheck className="h-6 w-6" />}
        isLoading={isLoading}
      />
      <StatCard
        title="Failed Items"
        value={stats.failed}
        subtitle="Requires attention"
        icon={<AlertTriangle className="h-6 w-6" />}
        variant="warning"
        isLoading={isLoading}
      />
      <StatCard
        title="Safety Score"
        value={`${stats.safetyScore}%`}
        subtitle="Fleet compliance"
        icon={<ShieldCheck className="h-6 w-6" />}
        variant="success"
        isLoading={isLoading}
      />
    </StaggerContainer>
  );
}
