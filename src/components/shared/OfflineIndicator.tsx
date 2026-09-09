'use client';

import { useEffect, useState } from 'react';
import { Wifi, WifiOff, CloudUpload, Loader2 } from 'lucide-react';
import { getQueueCount, syncQueuedSubmissions } from '@/lib/offline';
import { supabase } from '@/lib/supabase';
import { uploadEvidence } from '@/lib/evidence';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(true);
  const [queueCount, setQueueCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    setIsOnline(navigator.onLine);

    const handleOnline = () => {
      setIsOnline(true);
      toast.success('Back online');
      syncQueue();
    };
    const handleOffline = () => {
      setIsOnline(false);
      toast.warning('You are offline — inspections will be saved locally');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Check queue on mount
    checkQueue();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const checkQueue = async () => {
    try {
      const count = await getQueueCount();
      setQueueCount(count);
    } catch {
      // IndexedDB not available
    }
  };

  const syncQueue = async () => {
    setIsSyncing(true);
    try {
      const result = await syncQueuedSubmissions(async (payload, photoBlob) => {
        // The queued payload already carries the organization it was recorded against. Using
        // it — rather than the session's current organization — keeps a submission filed
        // under the tenant it was captured for, even if the user has since been moved.
        // The queue is untyped storage (IndexedDB, Record<string, unknown>), so narrow rather
        // than assert — a malformed queued row must fail this one submission, not the sync.
        const orgId =
          typeof payload.organization_id === 'string' ? payload.organization_id : null;
        if (!orgId) throw new Error('Queued submission has no organization; cannot sync.');

        let uploadedImagePath: string | null = null;
        if (photoBlob) {
          uploadedImagePath = await uploadEvidence('inspection', orgId, photoBlob);
        }

        const { error } = await supabase.from('inspections').insert([{
          ...payload,
          photo_url: uploadedImagePath ?? payload.photo_url,
        }]);
        if (error) throw error;
      });

      if (result.synced > 0) {
        toast.success(`Synced ${result.synced} inspection${result.synced > 1 ? 's' : ''}`);
      }
      if (result.failed > 0) {
        toast.error(`${result.failed} submission${result.failed > 1 ? 's' : ''} failed to sync`);
      }
    } catch {
      toast.error('Sync failed');
    } finally {
      setIsSyncing(false);
      checkQueue();
    }
  };

  // Only show when offline or have queued items
  if (isOnline && queueCount === 0) return null;

  return (
    <div className={cn(
      'fixed bottom-20 left-4 right-4 sm:left-auto sm:right-4 sm:w-auto z-40',
    )}>
      <div className={cn(
        'flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium shadow-elevated',
        isOnline
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted-foreground text-white'
      )}>
        {!isOnline ? (
          <>
            <WifiOff className="h-4 w-4" />
            <span>Offline Mode</span>
            {queueCount > 0 && (
              <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">
                {queueCount} queued
              </span>
            )}
          </>
        ) : queueCount > 0 ? (
          <>
            {isSyncing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CloudUpload className="h-4 w-4" />
            )}
            <span>{isSyncing ? 'Syncing...' : `${queueCount} pending`}</span>
            {!isSyncing && (
              <button onClick={syncQueue} className="underline text-xs ml-1">
                Sync now
              </button>
            )}
          </>
        ) : (
          <>
            <Wifi className="h-4 w-4" />
            <span>Online</span>
          </>
        )}
      </div>
    </div>
  );
}
