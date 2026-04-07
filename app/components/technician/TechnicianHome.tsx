'use client';

import { useEffect, useState, useCallback } from 'react';
import { ClipboardCheck, User, HardHat, ChevronRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth/AuthProvider';
import { supabase } from '@/lib/supabase';
import { config } from '@/lib/config';

interface TechnicianHomeProps {
  onStartInspection: (mode: 'manual' | 'ai') => void;
}

export function TechnicianHome({ onStartInspection }: TechnicianHomeProps) {
  const { profile, organization } = useAuth();
  const [todayCount, setTodayCount] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);

  const fetchStats = useCallback(async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let query = supabase
      .from('inspections')
      .select('status', { count: 'exact' })
      .gte('created_at', today.toISOString());

    if (organization) {
      query = query.eq('organization_id', organization.id);
    }

    const { data, count } = await query;
    setTodayCount(count || 0);
    setCompletedCount(data?.filter((d) => d.status === 'Safe').length || 0);
  }, [organization]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStats();
  }, [fetchStats]);

  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-primary shadow-industrial">
            <HardHat className="h-5 w-5 text-white" />
          </div>
          <span className="text-lg font-bold font-display text-foreground">{config.app.name}</span>
        </div>
        <button className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold">
          {profile?.full_name?.charAt(0)?.toUpperCase() || <User className="h-5 w-5" />}
        </button>
      </header>

      {/* Main */}
      <main className="flex flex-1 flex-col px-4 py-6">
        {/* Greeting */}
        <div className="mb-6 animate-fade-in">
          <p className="text-sm font-medium text-muted-foreground">{greeting},</p>
          <h1 className="text-3xl font-bold font-display text-foreground">
            {profile?.full_name?.split(' ')[0] || 'Technician'}
          </h1>
          <p className="mt-2 text-muted-foreground">Select inspection mode:</p>
        </div>

        {/* Stats */}
        <div className="mb-6 grid grid-cols-2 gap-4 animate-fade-in" style={{ animationDelay: '100ms' }}>
          <div className="rounded-2xl bg-card border border-border p-4 shadow-card">
            <p className="text-2xl font-bold font-display text-foreground">{todayCount}</p>
            <p className="text-sm text-muted-foreground">Today&apos;s Tasks</p>
          </div>
          <div className="rounded-2xl bg-success-bg border border-success/20 p-4 shadow-card">
            <p className="text-2xl font-bold font-display text-success">{completedCount}</p>
            <p className="text-sm text-success/80">Completed</p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-1 flex-col gap-4 animate-fade-in" style={{ animationDelay: '200ms' }}>
          {/* Manual Mode */}
          <Button
            onClick={() => onStartInspection('manual')}
            className="group flex h-32 w-full items-center justify-between px-8 rounded-3xl shadow-card hover:shadow-elevated transition-all border-2 border-transparent"
            variant="default"
          >
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 group-hover:scale-110 transition-transform">
                <ClipboardCheck className="h-8 w-8" />
              </div>
              <div className="text-left">
                <h3 className="text-xl font-bold font-display">Manual Check</h3>
                <p className="text-sm opacity-80 font-medium">Quick List</p>
              </div>
            </div>
            <ChevronRight className="h-6 w-6 opacity-60" />
          </Button>

          {/* AI Mode */}
          <Button
            onClick={() => onStartInspection('ai')}
            className="group flex h-32 w-full items-center justify-between px-8 rounded-3xl shadow-card hover:shadow-elevated transition-all bg-card border-2 border-primary/20 hover:border-primary/50 text-foreground"
            variant="outline"
          >
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary group-hover:scale-110 transition-transform">
                <Sparkles className="h-8 w-8" />
              </div>
              <div className="text-left">
                <h3 className="text-xl font-bold font-display">AI Guided</h3>
                <p className="text-sm text-primary/70 font-medium">Auto-Identify</p>
              </div>
            </div>
            <ChevronRight className="h-6 w-6 text-primary/40" />
          </Button>
        </div>
      </main>

      <div className="h-6 pb-safe" />
    </div>
  );
}
