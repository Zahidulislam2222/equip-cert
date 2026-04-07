'use client';

import { config } from '@/lib/config';
import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';

export default function PrivacyPolicyPage() {
  const appName = config.app.name;

  return (
    <div className="min-h-screen bg-background overflow-auto">
      <nav className="sticky top-0 z-50 border-b border-border glass">
        <div className="mx-auto flex h-16 max-w-4xl items-center px-4">
          <Link href="/" className="flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            <span className="font-bold font-display text-foreground">{appName}</span>
          </Link>
        </div>
      </nav>

      <main className="mx-auto max-w-4xl px-4 py-12">
        <h1 className="text-3xl font-bold font-display text-foreground mb-2">Privacy Policy</h1>
        <p className="text-muted-foreground mb-8">Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>

        <div className="prose prose-gray dark:prose-invert max-w-none space-y-6 text-foreground">
          <section>
            <h2 className="text-xl font-semibold font-display">1. Information We Collect</h2>
            <p className="text-muted-foreground leading-relaxed">
              {appName} collects information you provide directly: account details (name, email, organization),
              inspection data (equipment photos, checklist responses, GPS coordinates, digital signatures),
              and usage data (login times, feature usage).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold font-display">2. How We Use Your Information</h2>
            <p className="text-muted-foreground leading-relaxed">
              We use your data to: provide and improve our inspection platform, generate compliance reports,
              send notifications about scheduled inspections and corrective actions, ensure OSHA compliance
              record keeping, and analyze platform usage to improve features.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold font-display">3. Data Sharing</h2>
            <p className="text-muted-foreground leading-relaxed">
              We do not sell your personal information. We share data only with: your organization&apos;s
              authorized members (managers, admins), AI analysis providers (equipment photos only, for
              identification purposes), payment processors (Stripe, for billing), and as required by law
              (OSHA auditors, legal obligations).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold font-display">4. Data Retention</h2>
            <p className="text-muted-foreground leading-relaxed">
              Inspection records are retained for a minimum of 5 years per OSHA requirements (29 CFR 1904.33).
              Account data is retained while your account is active and deleted within 30 days of account closure,
              except where retention is required by law.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold font-display">5. Your Rights (CCPA/CPRA)</h2>
            <p className="text-muted-foreground leading-relaxed">
              California residents have the right to: know what personal information is collected, request
              deletion of personal information (subject to legal retention requirements), opt-out of the
              sale of personal information (we do not sell data), and non-discrimination for exercising
              privacy rights. We honor Global Privacy Control (GPC) signals.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold font-display">6. Security</h2>
            <p className="text-muted-foreground leading-relaxed">
              We implement industry-standard security measures: encryption in transit (TLS) and at rest,
              row-level security isolating organization data, audit logging of all access, signed inspection
              records that cannot be modified (ESIGN compliance), and regular security reviews.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold font-display">7. Contact</h2>
            <p className="text-muted-foreground leading-relaxed">
              For privacy inquiries, data requests, or to exercise your rights, contact us at
              privacy@equipcert.ai.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
