'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
        {/* The product, not an abstract gradient. A Blender still of the same
            extinguisher the landing page inspects, so the first authenticated screen
            belongs to the same set. Replaces a decorative blurred blob that also
            animated forever without honouring prefers-reduced-motion.

            eslint-disable below: next.config.ts sets output:"export" with
            images.unoptimized, so next/image would wrap this in client JS and
            optimize nothing. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/media/auth-still.webp"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
        />
        {/* Scrim: the copy sits top-left and bottom-left, which is where the render is
            darkest already, so this only has to guarantee the floor highlight never
            reaches the text. */}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-br from-sidebar-background/95 via-sidebar-background/70 to-transparent"
        />

        <div className="relative">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg gradient-primary shadow-card">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <span className="text-step-2 font-extrabold font-display">{config.app.name}</span>
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
              { value: 'Offline', label: 'Capture without signal' },
              { value: 'GPS', label: 'Tagged at the asset' },
              { value: 'Immutable', label: 'Locked once signed' },
            ].map((stat) => (
              <div key={stat.label} className="sc-fade">
                <div className="rounded-lg bg-white/5 backdrop-blur-sm border border-white/10 px-5 py-4">
                  <p className="text-step-2 font-extrabold font-display">{stat.value}</p>
                  <p className="text-xs text-sidebar-foreground/50">{stat.label}</p>
                </div>
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
        {/* Deliberately NOT a motion element. This subtree contains the credential form;
            an entrance animation that starts at opacity 0 makes signing in impossible if
            the animation never runs. */}
        <div className="w-full max-w-md space-y-8">
          <div className="lg:hidden flex items-center gap-2.5 mb-6">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg gradient-primary">
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <span className="text-step-1 font-bold font-display text-foreground">{config.app.name}</span>
          </div>

          <div>
            <h2 className="text-step-2 font-extrabold font-display text-foreground">Welcome back</h2>
            <p className="text-muted-foreground mt-1">Sign in to your account</p>
          </div>

          <AnimatePresence mode="wait">
            {magicLinkSent ? (
              <motion.div
                key="magic-link-sent"
                className="rounded-lg border border-success/20 bg-success-bg p-8 text-center"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ type: 'spring', stiffness: 200, damping: 25 }}
              >
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-lg bg-success/10 mb-4">
                  <Mail className="h-7 w-7 text-success" />
                </div>
                <h3 className="font-semibold text-foreground text-lg">Check your email</h3>
                <p className="text-sm text-muted-foreground mt-2">
                  We sent a login link to <strong className="text-foreground">{email}</strong>
                </p>
              </motion.div>
            ) : (
              <form key="login-form" onSubmit={handleLogin} className="space-y-5">
                <AnimatePresence>
                  {error && (
                    <motion.div
                      key="error"
                      className="rounded-lg bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive"
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ type: 'spring', stiffness: 200, damping: 25 }}
                    >
                      {error}
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full rounded-lg border border-input bg-card px-4 py-3.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
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
                      className="w-full rounded-lg border border-input bg-card px-4 py-3.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                      placeholder="••••••••"
                    />
                  </div>
                )}

                <div>
                  <Button type="submit" disabled={isLoading} className="w-full gap-2 h-12 rounded-lg text-base shadow-card transition-shadow duration-300">
                    {isLoading ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <>
                        {isMagicLink ? 'Send Magic Link' : 'Sign In'}
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>

                <div>
                  <button
                    type="button"
                    onClick={() => setIsMagicLink(!isMagicLink)}
                    className="w-full text-sm text-primary hover:text-primary/80 transition-colors flex items-center justify-center gap-2"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {isMagicLink ? 'Use password instead' : 'Sign in with magic link'}
                  </button>
                </div>
              </form>
            )}
          </AnimatePresence>

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
