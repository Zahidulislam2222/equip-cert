'use client';

import { motion, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';
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
  BarChart3,
  Shield,
  Clock,
  Camera,
} from 'lucide-react';
import Link from 'next/link';
import { FadeInView } from '@/components/motion/FadeInView';
import { StaggerContainer, StaggerItem } from '@/components/motion/StaggerGrid';
import { AnimatedCounter } from '@/components/motion/AnimatedCounter';
import { MotionCard } from '@/components/motion/MotionCard';
import { TextReveal } from '@/components/motion/TextReveal';
import { ParallaxFloat } from '@/components/motion/ParallaxFloat';
import { DrawLine } from '@/components/motion/DrawLine';

const features = [
  {
    icon: ScanEye,
    title: 'AI Equipment ID',
    description: 'Point your camera and let AI identify equipment type, serial number, and visible safety issues instantly.',
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-400/10',
    glowColor: 'group-hover:shadow-[0_0_30px_-5px_hsl(45_100%_55%/0.15)]',
  },
  {
    icon: ClipboardCheck,
    title: 'Smart Checklists',
    description: 'Dynamic safety checklists loaded from your CMS — the right questions for the right equipment, every time.',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-400/10',
    glowColor: 'group-hover:shadow-[0_0_30px_-5px_hsl(152_69%_45%/0.15)]',
  },
  {
    icon: FileText,
    title: 'OSHA-Ready Reports',
    description: 'Generate compliant PDF reports with equipment ID, inspector credentials, timestamps, and digital signatures.',
    color: 'text-blue-400',
    bgColor: 'bg-blue-400/10',
    glowColor: 'group-hover:shadow-[0_0_30px_-5px_hsl(210_100%_55%/0.15)]',
  },
  {
    icon: Zap,
    title: 'Corrective Actions',
    description: 'Failed items automatically trigger workflows with assignment, due dates, and resolution tracking.',
    color: 'text-orange-400',
    bgColor: 'bg-orange-400/10',
    glowColor: 'group-hover:shadow-[0_0_30px_-5px_hsl(16_100%_55%/0.15)]',
  },
  {
    icon: Bell,
    title: 'Real-Time Alerts',
    description: 'Get notified instantly when inspections fail, actions are overdue, or schedules are due.',
    color: 'text-rose-400',
    bgColor: 'bg-rose-400/10',
    glowColor: 'group-hover:shadow-[0_0_30px_-5px_hsl(0_80%_55%/0.15)]',
  },
  {
    icon: MapPin,
    title: 'GPS Evidence',
    description: 'Automatic location capture with every inspection — tamper-proof proof your team was on-site.',
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-400/10',
    glowColor: 'group-hover:shadow-[0_0_30px_-5px_hsl(190_80%_55%/0.15)]',
  },
];

const stats = [
  { value: 96, suffix: '%', label: 'Audit Pass Rate' },
  { value: 3, suffix: 'x', label: 'Faster Inspections' },
  { value: 50, suffix: '%', label: 'Less Paperwork' },
  { value: 24, suffix: '/7', label: 'Compliance Ready' },
];

const steps = [
  { num: '01', title: 'Scan Equipment', desc: 'Point your camera at any equipment. AI identifies it instantly.', icon: Camera },
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

// Fake dashboard data for the preview section
const dashboardStats = [
  { label: 'Inspections Today', value: 24, icon: ClipboardCheck, trend: '+12%' },
  { label: 'Safety Score', value: 97, icon: Shield, suffix: '%', trend: '+3%' },
  { label: 'Avg. Duration', value: 8, icon: Clock, suffix: 'min', trend: '-15%' },
  { label: 'Active Equipment', value: 342, icon: BarChart3, trend: '+28' },
];

export default function LandingPage() {
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress: heroScroll } = useScroll({
    target: heroRef,
    offset: ['start start', 'end start'],
  });
  const heroOpacity = useTransform(heroScroll, [0, 0.8], [1, 0]);
  const heroScale = useTransform(heroScroll, [0, 0.8], [1, 0.95]);

  return (
    <div className="min-h-screen overflow-auto bg-background">
      {/* === NAV === */}
      <motion.nav
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="sticky top-0 z-50 border-b border-border/50 glass"
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg gradient-primary">
              <ShieldCheck className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold font-display text-foreground">{config.app.name}</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
            <a href="#features" className="hover:text-primary transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-primary transition-colors">How It Works</a>
            <a href="#pricing" className="hover:text-primary transition-colors">Pricing</a>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/auth/login">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">Sign In</Button>
            </Link>
            <Link href="/auth/signup">
              <Button size="sm" className="gap-2 shadow-industrial">
                Get Started <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </motion.nav>

      {/* === HERO === */}
      <motion.section
        ref={heroRef}
        style={{ opacity: heroOpacity, scale: heroScale }}
        className="relative overflow-hidden"
      >
        {/* Grid background */}
        <div className="absolute inset-0 bg-grid opacity-40" />
        <div className="absolute inset-0 gradient-mesh" />

        {/* Radial glow behind mockup */}
        <div className="absolute top-1/2 right-[15%] -translate-y-1/2 h-[600px] w-[600px] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute top-20 left-[10%] h-[300px] w-[300px] rounded-full bg-accent/5 blur-[100px]" />

        <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:py-32">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Left: Text */}
            <div>
              <FadeInView delay={0.1}>
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-2 text-sm font-medium text-primary mb-8">
                  <Sparkles className="h-4 w-4" />
                  AI-Powered Equipment Inspections
                </div>
              </FadeInView>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-extrabold font-display text-foreground leading-[1.08] mb-6">
                <TextReveal
                  text="Equipment inspections."
                  delay={0.2}
                />
                <br />
                <TextReveal
                  text="Certified safe."
                  delay={0.5}
                  highlightWords={['Certified', 'safe.']}
                  highlightClassName="text-gradient"
                />
              </h1>

              <FadeInView delay={0.7}>
                <p className="text-lg sm:text-xl text-muted-foreground max-w-xl mb-10 leading-relaxed">
                  Identify equipment instantly, run dynamic safety checklists, capture GPS-tagged evidence, and generate OSHA-compliant reports — all from your phone.
                </p>
              </FadeInView>

              <StaggerContainer delay={0.9} className="flex flex-col sm:flex-row items-start gap-4 mb-10">
                <StaggerItem>
                  <Link href="/auth/signup">
                    <Button size="lg" className="gap-2 h-14 px-8 text-base rounded-xl shadow-glow hover:shadow-[0_0_40px_-5px_hsl(45_100%_55%/0.4)] transition-shadow duration-300">
                      Start Free <ArrowRight className="h-5 w-5" />
                    </Button>
                  </Link>
                </StaggerItem>
                <StaggerItem>
                  <Link href="/app/dashboard">
                    <Button variant="outline" size="lg" className="gap-2 h-14 px-8 text-base rounded-xl border-border/60 hover:border-primary/40 hover:bg-primary/5">
                      <Play className="h-4 w-4" /> View Demo
                    </Button>
                  </Link>
                </StaggerItem>
              </StaggerContainer>

              <StaggerContainer delay={1.1} className="flex flex-wrap items-center gap-5 text-sm text-muted-foreground">
                {['OSHA Compliant', 'ESIGN Ready', 'SOC 2 Designed'].map((badge) => (
                  <StaggerItem key={badge}>
                    <span className="flex items-center gap-1.5">
                      <CheckCircle className="h-4 w-4 text-success" /> {badge}
                    </span>
                  </StaggerItem>
                ))}
              </StaggerContainer>
            </div>

            {/* Right: Product Mockup */}
            <div className="relative hidden lg:block">
              <ParallaxFloat offset={20} direction="up">
                {/* Phone mockup */}
                <div className="relative mx-auto w-[280px]">
                  <div className="rounded-[2.5rem] border-2 border-border/40 bg-card p-3 shadow-elevated">
                    {/* Phone screen */}
                    <div className="rounded-[2rem] bg-background overflow-hidden">
                      {/* Status bar */}
                      <div className="flex items-center justify-between px-6 py-2 text-[10px] text-muted-foreground">
                        <span>9:41</span>
                        <div className="flex gap-1">
                          <div className="w-4 h-2 rounded-sm bg-muted-foreground/30" />
                          <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />
                        </div>
                      </div>
                      {/* App header */}
                      <div className="px-4 py-3 border-b border-border/50">
                        <div className="flex items-center gap-2">
                          <div className="h-6 w-6 rounded-md gradient-primary flex items-center justify-center">
                            <ShieldCheck className="h-3.5 w-3.5 text-primary-foreground" />
                          </div>
                          <span className="text-xs font-bold font-display text-foreground">Equipment Inspection</span>
                        </div>
                      </div>
                      {/* Checklist items */}
                      <div className="p-4 space-y-2.5">
                        {['Fire Extinguisher Check', 'Pressure Gauge', 'Safety Pin Intact', 'Hose Condition'].map((item, i) => (
                          <motion.div
                            key={item}
                            initial={{ opacity: 0, x: -10 }}
                            whileInView={{ opacity: 1, x: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: 1.2 + i * 0.15, type: 'spring', stiffness: 200, damping: 25 }}
                            className="flex items-center gap-2.5 p-2.5 rounded-lg bg-card border border-border/50"
                          >
                            <div className={`h-4 w-4 rounded-full flex items-center justify-center ${i < 3 ? 'bg-success/20' : 'bg-muted'}`}>
                              {i < 3 && <CheckCircle className="h-3 w-3 text-success" />}
                            </div>
                            <span className="text-[11px] text-foreground">{item}</span>
                            {i < 3 && <span className="ml-auto text-[9px] text-success font-medium">PASS</span>}
                          </motion.div>
                        ))}
                        {/* Progress bar */}
                        <div className="pt-2">
                          <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                            <span>Progress</span>
                            <span>75%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              whileInView={{ width: '75%' }}
                              viewport={{ once: true }}
                              transition={{ delay: 1.8, duration: 0.8, ease: 'easeOut' }}
                              className="h-full rounded-full gradient-primary"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </ParallaxFloat>

              {/* Floating dashboard card — top right */}
              <motion.div
                initial={{ opacity: 0, y: 20, x: 20 }}
                whileInView={{ opacity: 1, y: 0, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 1.5, type: 'spring', stiffness: 150, damping: 20 }}
                className="absolute -top-4 -right-8 w-56 rounded-xl border border-border/40 bg-card/95 backdrop-blur-sm p-4 shadow-elevated"
              >
                <div className="flex items-center gap-2 mb-3">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  <span className="text-xs font-semibold text-foreground">Safety Score</span>
                </div>
                <div className="text-2xl font-bold font-display text-primary mb-1">97%</div>
                <div className="flex items-center gap-1 text-[10px] text-success">
                  <ArrowRight className="h-2.5 w-2.5 rotate-[-45deg]" /> +3% this month
                </div>
              </motion.div>

              {/* Floating alert card — bottom left */}
              <motion.div
                initial={{ opacity: 0, y: 20, x: -20 }}
                whileInView={{ opacity: 1, y: 0, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 1.8, type: 'spring', stiffness: 150, damping: 20 }}
                className="absolute -bottom-6 -left-12 w-52 rounded-xl border border-border/40 bg-card/95 backdrop-blur-sm p-3 shadow-elevated"
              >
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-lg bg-success/10 flex items-center justify-center">
                    <CheckCircle className="h-4 w-4 text-success" />
                  </div>
                  <div>
                    <div className="text-[11px] font-medium text-foreground">Inspection Complete</div>
                    <div className="text-[10px] text-muted-foreground">Report generated</div>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </motion.section>

      {/* === STATS === */}
      <section className="border-y border-border/50 bg-card/50">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <StaggerContainer className="grid grid-cols-2 gap-8 md:grid-cols-4">
            {stats.map((stat) => (
              <StaggerItem key={stat.label} className="text-center">
                <AnimatedCounter
                  value={stat.value}
                  suffix={stat.suffix}
                  className="text-4xl sm:text-5xl font-bold font-display text-primary tabular-nums"
                />
                <p className="mt-2 text-sm font-medium text-muted-foreground">{stat.label}</p>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* === FEATURES === */}
      <section id="features" className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
        <FadeInView className="text-center mb-16">
          <p className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">Features</p>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold font-display text-foreground">
            Everything you need for<br />field inspections
          </h2>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
            One platform replaces your paper checklists, spreadsheets, and filing cabinets.
          </p>
        </FadeInView>

        <StaggerContainer className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <StaggerItem key={feature.title}>
                <MotionCard
                  className={`group relative overflow-hidden rounded-2xl border border-border/60 bg-card p-7 shadow-card transition-shadow duration-300 ${feature.glowColor}`}
                >
                  <div className="relative">
                    <div className={`inline-flex h-12 w-12 items-center justify-center rounded-xl ${feature.bgColor} mb-5`}>
                      <Icon className={`h-6 w-6 ${feature.color}`} />
                    </div>
                    <h3 className="text-lg font-semibold font-display text-foreground">{feature.title}</h3>
                    <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
                  </div>
                </MotionCard>
              </StaggerItem>
            );
          })}
        </StaggerContainer>
      </section>

      {/* === HOW IT WORKS === */}
      <section id="how-it-works" className="relative py-24">
        <div className="absolute inset-0 bg-grid-fine opacity-30" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
          <FadeInView className="text-center mb-16">
            <p className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">How It Works</p>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold font-display text-foreground">
              Three steps to compliance
            </h2>
          </FadeInView>

          <div className="relative max-w-4xl mx-auto">
            {/* Connecting line */}
            <div className="hidden md:block absolute top-16 left-[16%] right-[16%]">
              <DrawLine orientation="horizontal" />
            </div>

            <StaggerContainer className="grid gap-10 md:grid-cols-3">
              {steps.map((step) => {
                const Icon = step.icon;
                return (
                  <StaggerItem key={step.num} className="relative text-center">
                    <MotionCard hoverScale={1.03} hoverY={-6} className="inline-block">
                      <div className="relative inline-flex h-24 w-24 items-center justify-center rounded-2xl bg-card border border-border/60 shadow-card mb-6">
                        <span className="absolute -top-3 -right-3 flex h-8 w-8 items-center justify-center rounded-full gradient-primary text-xs font-bold text-primary-foreground shadow-industrial">
                          {step.num}
                        </span>
                        <Icon className="h-10 w-10 text-primary" />
                      </div>
                    </MotionCard>
                    <h3 className="text-lg font-semibold font-display text-foreground">{step.title}</h3>
                    <p className="mt-2 text-sm text-muted-foreground max-w-xs mx-auto">{step.desc}</p>
                  </StaggerItem>
                );
              })}
            </StaggerContainer>
          </div>
        </div>
      </section>

      {/* === DASHBOARD PREVIEW === */}
      <section className="py-24 overflow-hidden">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <FadeInView className="text-center mb-16">
            <p className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">Dashboard</p>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold font-display text-foreground">
              Your compliance command center
            </h2>
            <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
              Real-time visibility into every inspection, equipment status, and safety score across your organization.
            </p>
          </FadeInView>

          <FadeInView delay={0.2}>
            <div className="relative rounded-2xl border border-border/40 bg-card overflow-hidden shadow-elevated">
              {/* Dashboard header */}
              <div className="border-b border-border/50 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-3 w-3 rounded-full bg-destructive/60" />
                  <div className="h-3 w-3 rounded-full bg-warning/60" />
                  <div className="h-3 w-3 rounded-full bg-success/60" />
                </div>
                <div className="text-xs text-muted-foreground font-medium">EquipCert Dashboard</div>
                <div className="w-16" />
              </div>

              {/* Dashboard content */}
              <div className="p-6">
                {/* Stats row */}
                <StaggerContainer className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  {dashboardStats.map((stat) => {
                    const Icon = stat.icon;
                    return (
                      <StaggerItem key={stat.label}>
                        <div className="rounded-xl border border-border/40 bg-background/50 p-4">
                          <div className="flex items-center justify-between mb-2">
                            <Icon className="h-4 w-4 text-muted-foreground" />
                            <span className="text-[10px] font-medium text-success">{stat.trend}</span>
                          </div>
                          <div className="text-2xl font-bold font-display text-foreground">
                            {stat.value}{stat.suffix || ''}
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">{stat.label}</div>
                        </div>
                      </StaggerItem>
                    );
                  })}
                </StaggerContainer>

                {/* Fake chart area */}
                <div className="grid md:grid-cols-3 gap-4">
                  <div className="md:col-span-2 rounded-xl border border-border/40 bg-background/50 p-4">
                    <div className="text-xs font-semibold text-foreground mb-4">Inspections This Week</div>
                    <div className="flex items-end gap-2 h-32">
                      {[40, 65, 45, 80, 55, 90, 70].map((height, i) => (
                        <motion.div
                          key={i}
                          initial={{ height: 0 }}
                          whileInView={{ height: `${height}%` }}
                          viewport={{ once: true }}
                          transition={{ delay: 0.8 + i * 0.08, type: 'spring', stiffness: 100, damping: 15 }}
                          className="flex-1 rounded-t-md gradient-primary opacity-80"
                        />
                      ))}
                    </div>
                    <div className="flex justify-between mt-2 text-[10px] text-muted-foreground">
                      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                        <span key={d}>{d}</span>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/40 bg-background/50 p-4">
                    <div className="text-xs font-semibold text-foreground mb-4">Equipment Status</div>
                    <div className="space-y-3">
                      {[
                        { label: 'Operational', pct: 85, color: 'bg-success' },
                        { label: 'Needs Review', pct: 10, color: 'bg-warning' },
                        { label: 'Out of Service', pct: 5, color: 'bg-destructive' },
                      ].map((item) => (
                        <div key={item.label}>
                          <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                            <span>{item.label}</span>
                            <span>{item.pct}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              whileInView={{ width: `${item.pct}%` }}
                              viewport={{ once: true }}
                              transition={{ delay: 1, duration: 0.8, ease: 'easeOut' }}
                              className={`h-full rounded-full ${item.color}`}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </FadeInView>
        </div>
      </section>

      {/* === PRICING === */}
      <section id="pricing" className="py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <FadeInView className="text-center mb-16">
            <p className="text-sm font-semibold text-primary uppercase tracking-wider mb-3">Pricing</p>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold font-display text-foreground">
              Simple, transparent pricing
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Start free. Scale as your team grows. 14-day Pro trial included.
            </p>
          </FadeInView>

          <StaggerContainer className="grid gap-6 md:grid-cols-3 max-w-5xl mx-auto items-start">
            {plans.map((plan) => (
              <StaggerItem key={plan.name}>
                <MotionCard
                  hoverY={-6}
                  hoverScale={plan.highlighted ? 1.03 : 1.02}
                  className={`relative rounded-2xl border bg-card p-8 shadow-card ${
                    plan.highlighted
                      ? 'border-primary/50 ring-1 ring-primary/20 md:scale-105 md:-my-2'
                      : 'border-border/60'
                  }`}
                >
                  {plan.highlighted && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full gradient-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-industrial">
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
                </MotionCard>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* === CTA === */}
      <section className="relative overflow-hidden py-24">
        <div className="absolute inset-0 bg-grid opacity-20" />
        <div className="absolute inset-0 gradient-mesh" />
        <FadeInView className="relative mx-auto max-w-3xl px-4 text-center">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold font-display text-foreground">
            Ready to modernize your inspections?
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Join teams already saving hours on compliance. Start your free account today.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/auth/signup">
              <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.98 }}>
                <Button size="lg" className="gap-2 h-14 px-8 text-base rounded-xl shadow-glow hover:shadow-[0_0_40px_-5px_hsl(45_100%_55%/0.4)] transition-shadow duration-300">
                  Start Free <ArrowRight className="h-5 w-5" />
                </Button>
              </motion.div>
            </Link>
          </div>
        </FadeInView>
      </section>

      {/* === FOOTER === */}
      <footer className="border-t border-border/50 bg-card/50">
        <FadeInView>
          <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-primary">
                  <ShieldCheck className="h-4 w-4 text-primary-foreground" />
                </div>
                <span className="text-lg font-bold font-display text-foreground">{config.app.name}</span>
              </div>
              <div className="flex gap-6 text-sm text-muted-foreground">
                <Link href="/privacy" className="hover:text-primary transition-colors">Privacy Policy</Link>
                <Link href="/terms" className="hover:text-primary transition-colors">Terms of Service</Link>
              </div>
              <p className="text-sm text-muted-foreground">
                &copy; {new Date().getFullYear()} {config.app.name}. All rights reserved.
              </p>
            </div>
          </div>
        </FadeInView>
      </footer>
    </div>
  );
}
