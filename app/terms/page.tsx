'use client';

import { config } from '@/lib/config';
import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';

export default function TermsPage() {
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
        <h1 className="text-3xl font-bold font-display text-foreground mb-2">Terms of Service</h1>
        <p className="text-muted-foreground mb-8">Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>

        <div className="prose prose-gray dark:prose-invert max-w-none space-y-6 text-foreground">
          <section>
            <h2 className="text-xl font-semibold font-display">1. Acceptance</h2>
            <p className="text-muted-foreground leading-relaxed">
              By accessing or using {appName}, you agree to these Terms of Service. If you are using
              the service on behalf of an organization, you represent that you have authority to bind
              that organization to these terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold font-display">2. Service Description</h2>
            <p className="text-muted-foreground leading-relaxed">
              {appName} provides an AI-powered equipment inspection and safety compliance platform.
              Features include equipment identification, digital checklists, photo evidence capture,
              GPS location tracking, digital signatures, corrective action workflows, and PDF report
              generation.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold font-display">3. Electronic Signatures (ESIGN Act)</h2>
            <p className="text-muted-foreground leading-relaxed">
              By using the digital signature feature, you consent to conducting transactions electronically
              under the Electronic Signatures in Global and National Commerce Act (15 U.S.C. &sect;7001 et seq.).
              You acknowledge that your electronic signature carries the same legal weight as a handwritten
              signature. Signed inspection records are immutable and cannot be altered after submission.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold font-display">4. OSHA Compliance</h2>
            <p className="text-muted-foreground leading-relaxed">
              {appName} is designed to facilitate OSHA compliance (29 CFR 1926). However, users are
              responsible for ensuring their inspection practices meet all applicable regulatory requirements.
              {appName} does not replace the judgment of qualified safety professionals. Equipment marked
              as &quot;out of service&quot; must not be operated until cleared by a competent person.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold font-display">5. Subscription &amp; Billing</h2>
            <p className="text-muted-foreground leading-relaxed">
              Free tier: limited features as described on our pricing page. Paid plans are billed monthly
              per user. You may cancel at any time; access continues through the end of the billing period.
              We reserve the right to change pricing with 30 days notice.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold font-display">6. Data Ownership</h2>
            <p className="text-muted-foreground leading-relaxed">
              You retain ownership of all inspection data, photos, and reports created using {appName}.
              You grant us a limited license to process this data to provide the service. Upon account
              termination, you may export your data within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold font-display">7. Limitation of Liability</h2>
            <p className="text-muted-foreground leading-relaxed">
              {appName} is provided &quot;as is&quot; without warranty. We are not liable for equipment
              failures, safety incidents, regulatory fines, or any damages arising from use of the platform.
              Our liability is limited to the amount paid for the service in the 12 months preceding the claim.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
