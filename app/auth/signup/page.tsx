'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { signUp } from '@/lib/auth';
import { Loader2, ShieldCheck, ArrowRight, CheckCircle, Building2 } from 'lucide-react';
import { config } from '@/lib/config';
import Link from 'next/link';

export default function SignupPage() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState('');

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await signUp(email, password, fullName, orgName);
      setIsComplete(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Signup failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      {/* Left Panel — Branding */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-sidebar p-12 flex-col justify-between text-white">
        <div className="absolute inset-0 gradient-mesh opacity-30" />
        <div className="absolute top-20 right-0 h-80 w-80 rounded-full bg-accent/10 blur-3xl" />

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
            Start your free<br />
            <span className="text-primary">inspection platform.</span>
          </h1>
          <div className="space-y-4">
            {[
              'AI equipment identification',
              'OSHA-compliant reporting',
              'Corrective action tracking',
              'Digital signatures (ESIGN)',
              'GPS location evidence',
            ].map((feature) => (
              <div key={feature} className="flex items-center gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20">
                  <CheckCircle className="h-3.5 w-3.5 text-primary" />
                </div>
                <span className="text-sidebar-foreground/80">{feature}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-sidebar-foreground/40 text-xs">
          &copy; {new Date().getFullYear()} {config.app.name}. All rights reserved.
        </p>
      </div>

      {/* Right Panel — Signup Form */}
      <div className="flex w-full lg:w-1/2 items-center justify-center p-8 bg-background">
        <div className="w-full max-w-md space-y-8 animate-fade-in">
          <div className="lg:hidden flex items-center gap-2.5 mb-6">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg gradient-primary">
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold font-display text-foreground">{config.app.name}</span>
          </div>

          {isComplete ? (
            <div className="rounded-2xl border border-success/20 bg-success-bg p-10 text-center space-y-4 animate-scale-in">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-success/10">
                <CheckCircle className="h-9 w-9 text-success" />
              </div>
              <h3 className="text-xl font-bold font-display text-foreground">Account Created!</h3>
              <p className="text-sm text-muted-foreground">
                Check your email to verify your account, then{' '}
                <Link href="/auth/login" className="text-primary font-medium underline">sign in</Link>.
              </p>
            </div>
          ) : (
            <>
              <div>
                <h2 className="text-2xl font-bold font-display text-foreground">Create your account</h2>
                <p className="text-muted-foreground mt-1">Set up your organization in 60 seconds</p>
              </div>

              <form onSubmit={handleSignup} className="space-y-5">
                {error && (
                  <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive animate-fade-in">
                    {error}
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Full Name</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    className="w-full rounded-xl border border-input bg-card px-4 py-3.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                    placeholder="John Martinez"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground flex items-center gap-2">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    Organization Name
                  </label>
                  <input
                    type="text"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    required
                    className="w-full rounded-xl border border-input bg-card px-4 py-3.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                    placeholder="Acme Construction"
                  />
                </div>

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

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    className="w-full rounded-xl border border-input bg-card px-4 py-3.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                    placeholder="Minimum 8 characters"
                  />
                </div>

                <Button type="submit" disabled={isLoading} className="w-full gap-2 h-12 rounded-xl text-base shadow-industrial hover:shadow-glow transition-shadow duration-300">
                  {isLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      Create Account
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </form>

              <p className="text-center text-sm text-muted-foreground">
                Already have an account?{' '}
                <Link href="/auth/login" className="text-primary font-medium hover:underline">
                  Sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
