'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Wifi, WifiOff, CloudUpload, Loader2 } from 'lucide-react';
import { getQueueCount, syncQueuedSubmissions } from '@/lib/offline';
import { supabase } from '@/lib/supabase';
import { uploadEvidence } from '@/lib/evidence';
import { recordEsignConsent } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// Connectivity is browser state, not React state: read it through useSyncExternalStore so the
// value is correct on the first client render and no effect has to copy it into state. The
// static export prerenders as "online" (server snapshot), which is what hydration expects.
function subscribeOnline(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

export function OfflineIndicator() {
  const isOnline = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [queueCount, setQueueCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

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
      // Whose session is sending. A signed record may only be filed — and consent only recorded
      // — by the person who signed it: on a shared device, the next person to sign in must not
      // have consent stamped against their account for a colleague's signature. Such items stay
      // queued until the signer signs in here again. The database enforces the same rule.
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        toast.error('Sign in to send queued inspections.');
        return;
      }
      const { data: me } = await supabase.from('profiles').select('id').eq('user_id', auth.user.id).maybeSingle();
      const notMine = (item: { payload: { inspector_id?: string | null }; signatureBlob?: Blob | null }) =>
        !!item.signatureBlob && item.payload.inspector_id !== (me?.id ?? null);

      const result = await syncQueuedSubmissions(async ({ payload, photoBlob, signatureBlob, esignConsentVersion }) => {
        // The queued payload already carries the organization it was recorded against. Using
        // it — rather than the session's current organization — keeps a submission filed
        // under the tenant it was captured for, even if the user has since been moved.
        // The queue is untyped storage (IndexedDB, Record<string, unknown>), so narrow rather
        // than assert — a malformed queued row must fail this one submission, not the sync.
        const orgId =
          typeof payload.organization_id === 'string' ? payload.organization_id : null;
        if (!orgId) throw new Error('Queued submission has no organization; cannot sync.');

        // Consent first: a signed record must never reach the database before the evidence that
        // the signer agreed to sign electronically (DEF-074).
        if (esignConsentVersion) await recordEsignConsent(esignConsentVersion);

        let uploadedImagePath: string | null = null;
        if (photoBlob) {
          uploadedImagePath = await uploadEvidence('inspection', orgId, photoBlob);
        }
        let uploadedSignaturePath: string | null = null;
        if (signatureBlob) {
          uploadedSignaturePath = await uploadEvidence('signature', orgId, signatureBlob);
        }

        const { error } = await supabase.from('inspections').insert([{
          ...payload,
          photo_url: uploadedImagePath ?? payload.photo_url,
          signature_url: uploadedSignaturePath ?? payload.signature_url,
        }]);
        if (error) throw error;
      }, notMine);

      if (result.synced > 0) {
        toast.success(`Synced ${result.synced} inspection${result.synced > 1 ? 's' : ''}`);
      }
      if (result.held > 0) {
        toast.warning(
          `${result.held} signed inspection${result.held > 1 ? 's are' : ' is'} waiting for the person who signed to sign in on this device.`
        );
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

  // Declared after the functions it calls (react-hooks/immutability). Side effects of a
  // connectivity change only — the flag itself comes from useSyncExternalStore above.
  useEffect(() => {
    const handleOnline = () => {
      toast.success('Back online');
      syncQueue();
    };
    const handleOffline = () => {
      toast.warning('You are offline — inspections will be saved locally');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Check queue on mount — state is set in the promise callback, not the effect body.
    getQueueCount()
      .then(setQueueCount)
      .catch(() => {
        // IndexedDB not available
      });

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- register once per mount
  }, []);

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
