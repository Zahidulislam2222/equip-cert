'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ShieldCheck, X } from 'lucide-react';

export function CookieConsent() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem('cookie-consent');
    // Also honor GPC signal (CCPA requirement)
    const gpcEnabled = (navigator as unknown as Record<string, unknown>).globalPrivacyControl === true;

    if (!consent && !gpcEnabled) {
      // Small delay so it doesn't flash on load
      const timer = setTimeout(() => setShow(true), 1500);
      return () => clearTimeout(timer);
    }

    if (gpcEnabled && !consent) {
      // Auto-respect GPC signal — essential only
      localStorage.setItem('cookie-consent', JSON.stringify({ essential: true, analytics: false, timestamp: Date.now() }));
    }
  }, []);

  const handleAccept = (analytics: boolean) => {
    localStorage.setItem('cookie-consent', JSON.stringify({ essential: true, analytics, timestamp: Date.now() }));
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 sm:left-auto sm:max-w-md">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-elevated">
        <div className="flex items-start gap-3 mb-4">
          <ShieldCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-foreground text-sm">Privacy & Cookies</h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              We use essential cookies for the platform to work. Analytics cookies help us improve.
              You can change this anytime in Settings.
            </p>
          </div>
          <button onClick={() => setShow(false)} className="shrink-0 rounded-lg p-1 hover:bg-muted">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => handleAccept(false)} className="flex-1 rounded-lg text-xs">
            Essential Only
          </Button>
          <Button size="sm" onClick={() => handleAccept(true)} className="flex-1 rounded-lg text-xs">
            Accept All
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          We do not sell your data. We honor{' '}
          <a href="https://globalprivacycontrol.org/" target="_blank" rel="noopener noreferrer" className="underline">
            Global Privacy Control
          </a>{' '}
          signals automatically.{' '}
          <a href="/privacy" className="underline">Privacy Policy</a>
        </p>
      </div>
    </div>
  );
}
