'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { config } from '@/lib/config';
import {
  ShieldCheck,
  ScanEye,
  ClipboardCheck,
  FileText,
  Zap,
  Bell,
  MapPin,
  ArrowRight,
  CheckCircle,
  Star,
  Sparkles,
  Pen,
  Play,
} from 'lucide-react';
import Link from 'next/link';

const features = [
  {
    icon: ScanEye,
    title: 'AI Equipment ID',
    description: 'Point your camera and let AI identify equipment type, serial number, and visible safety issues instantly.',
    gradient: 'from-blue-500/10 to-blue-600/5',
    iconBg: 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400',
  },
  {
    icon: ClipboardCheck,
    title: 'Smart Checklists',
    description: 'Dynamic safety checklists loaded from your CMS — the right questions for the right equipment, every time.',
    gradient: 'from-emerald-500/10 to-emerald-600/5',
    iconBg: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400',
  },
  {
    icon: FileText,
    title: 'OSHA-Ready Reports',
    description: 'Generate compliant PDF reports with equipment ID, inspector credentials, timestamps, and digital signatures.',
    gradient: 'from-violet-500/10 to-violet-600/5',
    iconBg: 'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400',
  },
  {
    icon: Zap,
    title: 'Corrective Actions',
    description: 'Failed items automatically trigger workflows with assignment, due dates, and resolution tracking.',
    gradient: 'from-amber-500/10 to-amber-600/5',
    iconBg: 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400',
  },
  {
    icon: Bell,
    title: 'Real-Time Alerts',
    description: 'Get notified instantly when inspections fail, actions are overdue, or schedules are due.',
    gradient: 'from-rose-500/10 to-rose-600/5',
    iconBg: 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400',
  },
  {
    icon: MapPin,
    title: 'GPS Evidence',
    description: 'Automatic location capture with every inspection — tamper-proof proof your team was on-site.',
    gradient: 'from-cyan-500/10 to-cyan-600/5',
    iconBg: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-900/40 dark:text-cyan-400',
  },
];

const stats = [
  { value: 96, suffix: '%', label: 'Audit Pass Rate' },
  { value: 3, suffix: 'x', label: 'Faster Inspections' },
  { value: 50, suffix: '%', label: 'Less Paperwork' },
  { value: 24, suffix: '/7', label: 'Compliance Ready' },
];

const steps = [
  { num: '01', title: 'Scan Equipment', desc: 'Point your camera at any equipment. AI identifies it instantly.', icon: ScanEye },
  { num: '02', title: 'Run Checklist', desc: 'Dynamic safety questions load automatically. Tap pass or fail.', icon: ClipboardCheck },
  { num: '03', title: 'Sign & Submit', desc: 'Capture GPS, add your digital signature, generate the report.', icon: Pen },
];

const plans = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'For solo inspectors getting started',
    features: ['1 user', '10 inspections/month', '5 AI analyses/month', 'Basic PDF reports'],
    cta: 'Get Started',
    highlighted: false,
  },
  {
    name: 'Pro',
    price: '$29',
    period: '/user/mo',
    description: 'For teams that need full compliance',
    features: ['Unlimited inspections', 'Unlimited AI analysis', 'Corrective actions', 'Digital signatures', 'Scheduling', 'Priority support'],
    cta: 'Start Free Trial',
    highlighted: true,
  },
  {
    name: 'Enterprise',
    price: '$79',
    period: '/user/mo',
    description: 'For organizations at scale',
    features: ['Everything in Pro', 'SSO / SAML', 'API access', 'Custom branding', 'Multi-site analytics', 'Dedicated support'],
    cta: 'Contact Sales',
    highlighted: false,
  },
];

function AnimatedCounter({ value, suffix }: { value: number; suffix: string }) {
  const [count, setCount] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.5 }
    );
    const el = document.getElementById(`stat-${value}`);
    if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [value]);

  useEffect(() => {
    if (!visible) return;
    let start = 0;
    const duration = 1200;
    const stepTime = 16;
    const steps = duration / stepTime;
    const increment = value / steps;

    const timer = setInterval(() => {
      start += increment;
      if (start >= value) {
        setCount(value);
        clearInterval(timer);
      } else {
        setCount(Math.floor(start));
      }
    }, stepTime);

    return () => clearInterval(timer);
  }, [visible, value]);

  return (
    <span id={`stat-${value}`} className="text-4xl sm:text-5xl font-bold font-display text-primary tabular-nums">
      {count}{suffix}
    </span>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen overflow-auto bg-background">
      {/* === NAV === */}
      <nav className="sticky top-0 z-50 border-b border-border/50 glass">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg gradient-primary">
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold font-display text-foreground">{config.app.name}</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-foreground transition-colors">How It Works</a>
            <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/auth/login">
              <Button variant="ghost" size="sm">Sign In</Button>
            </Link>
            <Link href="/auth/signup">
              <Button size="sm" className="gap-2 shadow-industrial">
                Get Started <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* === HERO === */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 gradient-mesh" />
        <div className="absolute top-20 left-10 h-72 w-72 rounded-full bg-primary/5 blur-3xl animate-float" />
        <div className="absolute bottom-20 right-10 h-96 w-96 rounded-full bg-accent/5 blur-3xl animate-float" style={{ animationDelay: '1.5s' }} />

        <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-32 text-center">
          <div
            className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-2 text-sm font-medium text-primary mb-8 animate-fade-in shadow-sm"
          >
            <Sparkles className="h-4 w-4" />
            AI-Powered Equipment Inspections
          </div>

          <h1
            className="text-4xl sm:text-5xl lg:text-7xl font-extrabold font-display text-foreground leading-[1.1] max-w-5xl mx-auto animate-fade-in-up"
          >
            Equipment safety compliance,{' '}
            <span className="text-gradient">powered by AI.</span>
          </h1>

          <p
            className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto animate-fade-in-up"
            style={{ animationDelay: '0.1s' }}
          >
            Identify equipment instantly, run dynamic safety checklists, capture GPS-tagged evidence, and generate OSHA-compliant reports — all from your phone.
          </p>

          <div
            className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-in-up"
            style={{ animationDelay: '0.2s' }}
          >
            <Link href="/auth/signup">
              <Button size="lg" className="gap-2 h-14 px-8 text-base rounded-xl shadow-industrial hover:shadow-glow transition-shadow duration-300">
                Start Free <ArrowRight className="h-5 w-5" />
              </Button>
            </Link>
            <Link href="/app/dashboard">
              <Button variant="outline" size="lg" className="gap-2 h-14 px-8 text-base rounded-xl">
                <Play className="h-4 w-4" /> View Demo
              </Button>
            </Link>
          </div>

          <div
            className="mt-12 flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground animate-fade-in"
            style={{ animationDelay: '0.4s' }}
          >
            <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4 text-success" /> OSHA Compliant</span>
            <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4 text-success" /> ESIGN Ready</span>
            <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4 text-success" /> SOC 2 Designed</span>
          </div>
        </div>
      </section>

      {/* === STATS === */}
      <section className="border-y border-border bg-card">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <AnimatedCounter value={stat.value} suffix={stat.suffix} />
                <p className="mt-2 text-sm font-medium text-muted-foreground">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* === FEATURES === */}
      <section id="features" className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
        <div className="text-center mb-16">
          <p className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">Features</p>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold font-display text-foreground">
            Everything you need for<br />field inspections
          </h2>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
            One platform replaces your paper checklists, spreadsheets, and filing cabinets.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, i) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.title}
                className="group relative overflow-hidden rounded-2xl border border-border bg-card p-7 shadow-card transition-all duration-300 hover:shadow-elevated hover:-translate-y-1"
                style={{ animationDelay: `${i * 0.08}s` }}
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${feature.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
                <div className="relative">
                  <div className={`inline-flex h-12 w-12 items-center justify-center rounded-xl ${feature.iconBg} mb-5 transition-transform duration-300 group-hover:scale-110`}>
                    <Icon className="h-6 w-6" />
                  </div>
                  <h3 className="text-lg font-semibold font-display text-foreground">{feature.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* === HOW IT WORKS === */}
      <section id="how-it-works" className="bg-muted/30 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">How It Works</p>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold font-display text-foreground">
              Three steps to compliance
            </h2>
          </div>
          <div className="grid gap-8 md:grid-cols-3 max-w-4xl mx-auto">
            {steps.map((step, i) => {
              const Icon = step.icon;
              return (
                <div key={step.num} className="relative text-center group">
                  {i < steps.length - 1 && (
                    <div className="hidden md:block absolute top-12 left-[60%] w-[80%] h-px border-t-2 border-dashed border-border" />
                  )}
                  <div className="relative inline-flex h-24 w-24 items-center justify-center rounded-2xl bg-card border border-border shadow-card mb-6 group-hover:shadow-elevated group-hover:-translate-y-1 transition-all duration-300">
                    <span className="absolute -top-3 -right-3 flex h-8 w-8 items-center justify-center rounded-full gradient-primary text-xs font-bold text-white shadow-industrial">
                      {step.num}
                    </span>
                    <Icon className="h-10 w-10 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold font-display text-foreground">{step.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground max-w-xs mx-auto">{step.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* === PRICING === */}
      <section id="pricing" className="py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">Pricing</p>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold font-display text-foreground">
              Simple, transparent pricing
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Start free. Scale as your team grows. 14-day Pro trial included.
            </p>
          </div>
          <div className="grid gap-8 md:grid-cols-3 max-w-5xl mx-auto items-start">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`relative rounded-2xl border bg-card p-8 shadow-card transition-all duration-300 hover:shadow-elevated ${
                  plan.highlighted
                    ? 'border-primary ring-2 ring-primary/20 md:scale-105 md:-my-2'
                    : 'border-border'
                }`}
              >
                {plan.highlighted && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full gradient-primary px-4 py-1.5 text-xs font-semibold text-white shadow-industrial">
                    <Star className="h-3 w-3" /> Most Popular
                  </div>
                )}
                <h3 className="text-lg font-semibold font-display text-foreground">{plan.name}</h3>
                <p className="text-sm text-muted-foreground mt-1">{plan.description}</p>
                <div className="mt-6 mb-6">
                  <span className="text-4xl font-bold font-display text-foreground">{plan.price}</span>
                  <span className="text-muted-foreground text-sm ml-1">{plan.period}</span>
                </div>
                <ul className="space-y-3 mb-8">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2.5 text-sm text-foreground">
                      <CheckCircle className="h-4 w-4 text-success shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link href="/auth/signup" className="block">
                  <Button
                    className={`w-full ${plan.highlighted ? 'shadow-industrial' : ''}`}
                    variant={plan.highlighted ? 'default' : 'outline'}
                  >
                    {plan.cta}
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* === CTA === */}
      <section className="relative overflow-hidden bg-sidebar py-20">
        <div className="absolute inset-0 gradient-mesh opacity-30" />
        <div className="relative mx-auto max-w-3xl px-4 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold font-display text-white">
            Ready to modernize your inspections?
          </h2>
          <p className="mt-4 text-lg text-sidebar-foreground/70">
            Join teams already saving hours on compliance. Start your free account today.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/auth/signup">
              <Button size="lg" className="gap-2 h-14 px-8 text-base rounded-xl shadow-glow">
                Start Free <ArrowRight className="h-5 w-5" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* === FOOTER === */}
      <footer className="border-t border-border bg-card">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-primary">
                <ShieldCheck className="h-4 w-4 text-white" />
              </div>
              <span className="text-lg font-bold font-display text-foreground">{config.app.name}</span>
            </div>
            <div className="flex gap-6 text-sm text-muted-foreground">
              <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
              <Link href="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
            </div>
            <p className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} {config.app.name}. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
