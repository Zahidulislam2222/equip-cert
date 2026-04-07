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

        <div className="space-y-8 text-foreground">
          <section>
            <h2 className="text-xl font-semibold font-display mb-3">1. Acceptance</h2>
            <p className="text-muted-foreground leading-relaxed">
              By accessing or using {appName}, you agree to these Terms of Service. If you are using
              the service on behalf of an organization, you represent that you have authority to bind
              that organization to these terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold font-display mb-3">2. Service Description</h2>
            <p className="text-muted-foreground leading-relaxed">
              {appName} provides an AI-powered equipment inspection and safety compliance platform.
              Features include equipment identification, digital checklists, photo evidence capture,
              GPS location tracking, digital signatures, corrective action workflows, and PDF report
              generation.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold font-display mb-3">3. Electronic Signatures (ESIGN Act Compliance)</h2>
            <p className="text-muted-foreground leading-relaxed mb-3">
              {appName} uses electronic signatures under the Electronic Signatures in Global and National
              Commerce Act (15 U.S.C. &sect;7001 et seq.) and applicable state UETA laws.
            </p>
            <p className="text-muted-foreground leading-relaxed mb-3">
              <strong>Consent process:</strong> Before signing any inspection record electronically, you will
              be presented with a consent checkbox that requires your AFFIRMATIVE agreement. By checking
              &quot;I agree to sign electronically&quot; and clicking &quot;Confirm Signature,&quot; you:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground leading-relaxed">
              <li>AFFIRMATIVELY CONSENT to creating electronic inspection records.</li>
              <li>Acknowledge your electronic signature has the same legal effect as a handwritten signature.</li>
              <li>Understand that signed records are IMMUTABLE and cannot be modified after submission.</li>
              <li>Accept that inspection records may be shared with OSHA during regulatory audits.</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-3">
              <strong>Hardware/software requirements:</strong> A modern web browser (Chrome, Safari, Firefox, Edge)
              with TLS 1.2+ support and JavaScript enabled. Touch-screen device recommended for signature capture.
            </p>
            <p className="text-muted-foreground leading-relaxed mt-3">
              <strong>Withdrawal of consent:</strong> You may withdraw consent to electronic signatures at any time
              by contacting your organization administrator. After withdrawal, you will not be able to sign
              inspection records electronically. Previously signed records remain valid and immutable.
            </p>
            <p className="text-muted-foreground leading-relaxed mt-3">
              <strong>Paper copies:</strong> You may request a paper copy of any signed inspection record within
              30 days of signing by contacting support.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold font-display mb-3">4. OSHA Compliance</h2>
            <p className="text-muted-foreground leading-relaxed">
              {appName} is designed to facilitate OSHA compliance (29 CFR 1926). However, users are
              responsible for ensuring their inspection practices meet all applicable regulatory requirements.
              {appName} does not replace the judgment of qualified safety professionals. Equipment marked
              as &quot;out of service&quot; must not be operated until cleared by a competent person.
              Inspection records are retained for 5+ years per OSHA requirements.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold font-display mb-3">5. Subscription &amp; Billing</h2>
            <p className="text-muted-foreground leading-relaxed">
              Free tier: limited features as described on our pricing page. Paid plans are billed monthly
              per user via Stripe. You may cancel at any time; access continues through the end of the
              billing period. We reserve the right to change pricing with 30 days notice. Refunds are
              available within 14 days of initial purchase.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold font-display mb-3">6. Data Ownership</h2>
            <p className="text-muted-foreground leading-relaxed">
              You retain ownership of all inspection data, photos, and reports created using {appName}.
              You grant us a limited license to process this data solely to provide the service. Upon account
              termination, you may export your data within 30 days. After 30 days, account data is deleted
              (inspection records retained per OSHA requirements).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold font-display mb-3">7. Limitation of Liability</h2>
            <p className="text-muted-foreground leading-relaxed">
              {appName} is provided &quot;as is&quot; without warranty of any kind. We are not liable for
              equipment failures, safety incidents, regulatory fines, or any indirect, incidental, or
              consequential damages arising from use of the platform. Our total aggregate liability is
              limited to the amount paid for the service in the 12 months preceding the claim.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold font-display mb-3">8. Dispute Resolution</h2>
            <p className="text-muted-foreground leading-relaxed">
              Any disputes shall be resolved through binding arbitration under the American Arbitration
              Association rules. The arbitration shall take place in the state where the subscribing
              organization is headquartered. This agreement is governed by the laws of the State of Delaware.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
