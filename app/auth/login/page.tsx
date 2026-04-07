'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { signIn, signInWithMagicLink } from '@/lib/auth';
import { Loader2, ShieldCheck, ArrowRight, Mail, Sparkles } from 'lucide-react';
import { config } from '@/lib/config';
import Link from 'next/link';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isMagicLink, setIsMagicLink] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      if (isMagicLink) {
        await signInWithMagicLink(email);
        setMagicLinkSent(true);
      } else {
        await signIn(email, password);
        window.location.href = '/app/dashboard';
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      {/* Left Panel — Branding */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-sidebar p-12 flex-col justify-between text-white">
        <div className="absolute inset-0 gradient-mesh opacity-30" />
        <div className="absolute bottom-0 right-0 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />

        <div className="relative">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg gradient-primary shadow-industrial">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <span className="text-2xl font-bold font-display">{config.app.name}</span>
          </div>
          <p className="text-sidebar-foreground/60 text-sm">AI-Powered Safety Compliance</p>
        </div>

        <div className="relative space-y-8">
          <h1 className="text-4xl xl:text-5xl font-extrabold font-display leading-tight">
            Equipment inspections,<br />
            <span className="text-primary">powered by AI.</span>
          </h1>
          <p className="text-sidebar-foreground/70 text-lg max-w-md">
            Identify equipment instantly, run safety checklists, generate OSHA-compliant reports — all from your phone.
          </p>
          <div className="flex gap-4">
            {[
              { value: '96%', label: 'Audit Pass Rate' },
              { value: '3x', label: 'Faster Inspections' },
              { value: 'OSHA', label: 'Compliant' },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl bg-white/5 backdrop-blur-sm border border-white/10 px-5 py-4">
                <p className="text-2xl font-bold font-display">{stat.value}</p>
                <p className="text-xs text-sidebar-foreground/50">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-sidebar-foreground/40 text-xs">
          &copy; {new Date().getFullYear()} {config.app.name}. All rights reserved.
        </p>
      </div>

      {/* Right Panel — Login Form */}
      <div className="flex w-full lg:w-1/2 items-center justify-center p-8 bg-background">
        <div className="w-full max-w-md space-y-8 animate-fade-in">
          <div className="lg:hidden flex items-center gap-2.5 mb-6">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg gradient-primary">
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold font-display text-foreground">{config.app.name}</span>
          </div>

          <div>
            <h2 className="text-2xl font-bold font-display text-foreground">Welcome back</h2>
            <p className="text-muted-foreground mt-1">Sign in to your account</p>
          </div>

          {magicLinkSent ? (
            <div className="rounded-2xl border border-success/20 bg-success-bg p-8 text-center animate-scale-in">
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-success/10 mb-4">
                <Mail className="h-7 w-7 text-success" />
              </div>
              <h3 className="font-semibold text-foreground text-lg">Check your email</h3>
              <p className="text-sm text-muted-foreground mt-2">
                We sent a login link to <strong className="text-foreground">{email}</strong>
              </p>
            </div>
          ) : (
            <form onSubmit={handleLogin} className="space-y-5">
              {error && (
                <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive animate-fade-in">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full rounded-xl border border-input bg-card px-4 py-3.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                  placeholder="you@company.com"
                />
              </div>

              {!isMagicLink && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full rounded-xl border border-input bg-card px-4 py-3.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                    placeholder="••••••••"
                  />
                </div>
              )}

              <Button type="submit" disabled={isLoading} className="w-full gap-2 h-12 rounded-xl text-base shadow-industrial hover:shadow-glow transition-shadow duration-300">
                {isLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    {isMagicLink ? 'Send Magic Link' : 'Sign In'}
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>

              <button
                type="button"
                onClick={() => setIsMagicLink(!isMagicLink)}
                className="w-full text-sm text-primary hover:text-primary/80 transition-colors flex items-center justify-center gap-2"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {isMagicLink ? 'Use password instead' : 'Sign in with magic link'}
              </button>
            </form>
          )}

          <p className="text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{' '}
            <Link href="/auth/signup" className="text-primary font-medium hover:underline">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
