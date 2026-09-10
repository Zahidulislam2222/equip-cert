'use client';

import { useEffect, useState } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isGranted } from '@/lib/compliance/consent';

type Theme = 'light' | 'dark' | 'system';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    const stored = localStorage.getItem('theme') as Theme | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored) setTheme(stored);
  }, []);

  useEffect(() => {
    const root = document.documentElement;

    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.classList.toggle('dark', prefersDark);
      localStorage.removeItem('theme');
    } else {
      root.classList.toggle('dark', theme === 'dark');
      // The theme applies either way — the visual choice is honoured for this page view.
      // Only PERSISTING it is optional storage, and that needs consent. Applying without
      // storing is the honest reading of "reject optional": the feature still works, it
      // simply does not follow you to the next visit.
      if (isGranted('preferences')) {
        localStorage.setItem('theme', theme);
      }
    }
  }, [theme]);

  const options: { value: Theme; icon: typeof Sun; label: string }[] = [
    { value: 'light', icon: Sun, label: 'Light' },
    { value: 'dark', icon: Moon, label: 'Dark' },
    { value: 'system', icon: Monitor, label: 'System' },
  ];

  return (
    <div className="flex rounded-lg border border-border bg-muted p-1 gap-1">
      {options.map((opt) => {
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            onClick={() => setTheme(opt.value)}
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all',
              theme === opt.value
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="h-4 w-4" />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
