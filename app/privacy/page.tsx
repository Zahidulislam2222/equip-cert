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

        <div className="space-y-8 text-foreground">
          <section>
            <h2 className="text-xl font-semibold font-display mb-3">1. Information We Collect &amp; Purpose</h2>
            <p className="text-muted-foreground leading-relaxed mb-3">
              {appName} collects the following categories of personal information for the stated purposes:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground leading-relaxed">
              <li><strong>Account information</strong> (name, email, organization, role) — to provide access, manage accounts, and assign roles.</li>
              <li><strong>Inspection data</strong> (equipment photos, checklist responses, GPS coordinates, digital signatures, device information) — to conduct inspections, generate compliance reports, and meet OSHA record-keeping requirements.</li>
              <li><strong>Usage data</strong> (login times, feature usage, browser/device type) — to improve platform performance and user experience.</li>
              <li><strong>Payment information</strong> (processed by Stripe; we do not store card numbers) — to manage subscriptions and billing.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold font-display mb-3">2. How We Use Your Information</h2>
            <p className="text-muted-foreground leading-relaxed">
              We use your data to: provide and operate the inspection platform, generate OSHA-compliant safety reports,
              send notifications about scheduled inspections and corrective actions, process subscription payments,
              analyze usage to improve features, and comply with legal obligations including OSHA record-keeping requirements (29 CFR 1904.33).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold font-display mb-3">3. Data Sharing &amp; Third Parties</h2>
            <p className="text-muted-foreground leading-relaxed mb-3">
              We do NOT sell or share your personal information for cross-context behavioral advertising.
              We share data only with the following categories of third parties for the stated purposes:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground leading-relaxed">
              <li><strong>Your organization&apos;s members</strong> (managers, admins) — to enable team-based inspections and oversight.</li>
              <li><strong>AI analysis providers</strong> (Google, OpenAI, or Anthropic — equipment photos only) — to identify equipment type.</li>
              <li><strong>Payment processor</strong> (Stripe) — to process subscription payments.</li>
              <li><strong>Hosting &amp; infrastructure</strong> (Vercel, Supabase) — to host and operate the platform.</li>
              <li><strong>Content management</strong> (Contentful) — to serve equipment checklists.</li>
              <li><strong>Regulatory authorities</strong> (OSHA) — inspection records may be shared during regulatory audits or investigations as required by law.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold font-display mb-3">4. Data Retention</h2>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground leading-relaxed">
              <li><strong>Inspection records</strong> (checklist data, photos, signatures, GPS) — retained for a minimum of 5 years per OSHA requirements (29 CFR 1904.33), even after account closure.</li>
              <li><strong>Account data</strong> (name, email, password hash) — retained while active; deleted within 30 days of account closure.</li>
              <li><strong>Usage data</strong> — retained for 12 months, then anonymized.</li>
              <li><strong>Payment records</strong> — retained per Stripe&apos;s policies and applicable tax law.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold font-display mb-3">5. Your Rights (CCPA/CPRA)</h2>
            <p className="text-muted-foreground leading-relaxed mb-3">
              If you are a California resident, you have the following rights under the CCPA/CPRA (Cal. Civ. Code &sect;1798.100 et seq.):
            </p>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground leading-relaxed">
              <li><strong>Right to Know</strong> — Request what personal information we collect, use, disclose, and sell.</li>
              <li><strong>Right to Delete</strong> — Request deletion of personal information (subject to OSHA retention requirements).</li>
              <li><strong>Right to Opt-Out of Sale/Sharing</strong> — We do not sell your data. If this changes, we will provide an opt-out mechanism.</li>
              <li><strong>Right to Non-Discrimination</strong> — We will not discriminate against you for exercising your rights.</li>
              <li><strong>Right to Correct</strong> — Request correction of inaccurate personal information.</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-3">
              We honor Global Privacy Control (GPC) signals. When detected, we automatically limit data processing to essential-only.
              To exercise any right, email privacy@equipcert.ai. We will respond within 45 days.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold font-display mb-3">6. OSHA Regulatory Disclosure</h2>
            <p className="text-muted-foreground leading-relaxed">
              Inspection records created in {appName} may be accessed by OSHA inspectors during regulatory
              audits or investigations. These records are retained for 5+ years per 29 CFR 1904.33.
              Data subjects include technicians who perform inspections, managers who review them,
              and any personnel identified in inspection reports. This data sharing is required by law
              and cannot be opted out of.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold font-display mb-3">7. Security</h2>
            <p className="text-muted-foreground leading-relaxed">
              We implement industry-standard security: encryption in transit (TLS 1.2+) and at rest,
              row-level security isolating organization data, audit logging of all access, signed inspection
              records that cannot be modified (ESIGN compliance), Content Security Policy headers,
              HSTS enforcement, and regular security reviews.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold font-display mb-3">8. Contact</h2>
            <p className="text-muted-foreground leading-relaxed">
              For privacy inquiries, data requests, or to exercise your CCPA rights:
              <br />Email: privacy@equipcert.ai
              <br />Response time: within 45 calendar days.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
