# Legal and regulatory map

Which laws apply to EquipCert AI, what the codebase does about each, and what is still open.

**Reviewed:** 2026-11-25 (product facts checked against the code and the hosted database as
released on 2026-11-25; time-sensitive legal dates re-checked the same day, see the sources at the
end) · **Status:** engineering position, **not legal advice, not reviewed by counsel.** The
policies still carry placeholders for the operator's legal identity. Every row below says *why* a
law applies or does not, so the reasoning can be checked rather than trusted.

**State of the platform on 2026-11-25.** The hosted database runs in the EU (Frankfurt). All 11
migrations in `supabase/migrations/` are applied to it. It holds 13 tables, every one with
row-level security enabled and 12 with it FORCEd; the exception, `plan_limits`, is shared
read-only reference data with no personal data and no tenant.

Status labels used throughout:

| Label | Meaning |
|---|---|
| **Implemented** | Enforced in code or the database, with a test or a reproducible check |
| **Documented** | A written record or procedure exists in this folder; no code is involved |
| **Partial** | Part of the obligation is met; the gap is named |
| **Planned** | On the [roadmap](../ROADMAP.md); nothing built yet |
| **Not applicable** | The reasoning is given, with the trigger that would change it |

---

## 1. Safety record-keeping — the reason the product exists

| Law / standard | What it requires | What EquipCert does | Status |
|---|---|---|---|
| **OSHA 29 CFR 1910.157(e)(2)** | Portable extinguishers "shall be visually inspected monthly" | Recurring schedules per equipment item; overdue items are flagged on the schedule page and equipment cards | Implemented |
| **OSHA 29 CFR 1910.157(e)(3)** | Record the annual maintenance date and retain it "for one year after the last entry or the life of the shell, whichever is less" | Inspector, date and findings on every record. The record time is the database's: a `BEFORE INSERT` trigger overwrites any `created_at` a client sends with the server clock (migration `20261125000300`), so a record cannot be backdated or postdated, and filing an inspection advances the equipment's due dates from that server time. Retention window configurable per organisation with a floor | Implemented — `e2e/local/tenancy.test.mjs` |
| **NFPA 10** (edition adopted by the local authority having jurisdiction) | Monthly inspection records kept at least 12 months (§7.2.2.6 in the edition the schema cites) | Retention floor encoded in the schema. Nobody can delete a signed record, and a trigger rejects every `UPDATE` of one except two exact shapes: the erasure of the signer (§3), and, when an administrator removes a member, the foreign key clearing `inspector_id` while every other column, including the signer's name and signature, stays byte-identical | Implemented |

The product records evidence of inspections. It does not perform them and does not certify
equipment: the employer remains responsible under 1910.157(e)(1). The AI proposes; a named human
reviews and signs every result ([AI Act memo](ai-act-classification.md) §6).

## 2. Electronic signatures

| Law | Requirement | What EquipCert does | Status |
|---|---|---|---|
| **US ESIGN Act** (15 U.S.C. §7001) and **UETA** (adopted in 49 states) | Intent to sign; consent to do business electronically; signature attributable to the signer and logically associated with the record; record retained and accurately reproducible | **Consent shown:** web and mobile show the same wording, owned by `src/content/esign-consent.json` (version `2026-11-25`; `mobile/test/esign_consent_contract_test.dart` keeps the Flutter copy identical), behind an explicit "I agree to sign electronically" control. **Consent stored as evidence (DEF-074, closed 2026-11-25):** agreeing calls `record_esign_consent`, which records on the signer's account that consent was given, the version of the wording shown, and the time. The time is always the server's; a client-supplied time is overwritten. Only the person signing can record their own consent, and it cannot be cleared by editing the profile. **Enforced:** the database refuses a signed inspection, on `INSERT` and on an `UPDATE` that adds a signature, unless it is filed by the inspector it names and that person has consent and a wording version on record (migrations `20261125000100` and `20261125000200`). The signature is bound to the signed-in account and the inspection row; signed rows are immutable; PDF reports reproduce the record. **Gaps:** the evidence is held on the signer's account, not copied onto each signed record, so when an administrator removes that member the account row is deleted with the consent time and version, while the signed record keeps the name and signature. The wording says consent may be withdrawn through the administrator, but the database has no way to record a withdrawal | Implemented for consent capture and enforcement; Partial for keeping the evidence after a member is removed and for recording a withdrawal |
| **ESIGN §101(c) consumer disclosures** | Extra disclosures when the signer is a *consumer* | Signers are an organisation's employees acting in a business capacity, not consumers | Not applicable — would change if the product were sold to individuals |
| **EU eIDAS Art. 25(1)** | A simple electronic signature may not be denied legal effect or admissibility solely because it is electronic | Art. 25(1) itself needs no specific control; evidential weight rests on attribution and integrity: signed-row immutability, server-set record times, recorded e-sign consent, and the trigger-written audit log, all live on the hosted database (the audit log since 2026-10-01) | Implemented for Art. 25(1); evidential controls Implemented, with the consent-retention gap named in the ESIGN row |
| **eIDAS qualified signatures** | Equivalent to handwritten across the EU | Not offered. A qualified signature needs a qualified trust service provider | Not applicable today; on the roadmap if a customer's regulator demands it |

## 3. Privacy — EU

| Law | What EquipCert does | Status | Record |
|---|---|---|---|
| **GDPR Art. 5, 6, 13** — lawful basis and transparency | Privacy policy rendered from one content file, versioned; each processing activity has a stated basis | Implemented | [record-of-processing.md](record-of-processing.md) |
| **GDPR Art. 15–22** — data subject rights | Public request intake at `/privacy/requests` with statutory deadlines tracked in the database | Implemented | `supabase/migrations/*_dsar_intake.sql` |
| **GDPR Art. 17 vs. safety retention** | Erasure separates the *person* from the *record*: the inspector is anonymised, the safety finding survives. Enforced by one exact, trigger-permitted update shape. `erase_subject` performs it; only the service role can call it (after identity verification in the privacy request queue, never from a client), and it also removes the person's account reference and address from audit entries | Implemented — live on the hosted database since 2026-10-01; `e2e/audit-log.test.mjs` | [data-processing-position.md](data-processing-position.md) |
| **GDPR Art. 28** — processor terms | Controller / processor split and DPA contents written down | Documented | [data-processing-position.md](data-processing-position.md) |
| **GDPR Art. 28(2), (4)** — sub-processors | Short list. `npm run test:config` (which also runs inside `npm run build` and in CI) reads every external origin in the Content-Security-Policy in `vercel.json` and fails if one is missing from the sub-processor document (the DEF-066 gate). Two public services without a DPA (geocoding, breached-password check) are listed separately. OpenRouter, added 2026-11-25 for the help assistant, has no DPA or transfer basis yet | Partial — the gate covers browser origins, not server-side calls; the two services without a DPA have no processing agreement; OpenRouter is not cleared for real customer data | [sub-processors.md](sub-processors.md) |
| **GDPR Art. 30** — record of processing | Maintained | Documented | [record-of-processing.md](record-of-processing.md) |
| **GDPR Art. 32** — security of processing | Row-level security, encryption in transit, least privilege; trigger-written audit log live since 2026-10-01 | Partial | [SECURITY-MODEL.md](../SECURITY-MODEL.md) |
| **GDPR Art. 33 / 34** — breach notification | 72-hour procedure with the authority's minimum content | Documented | [breach-response.md](breach-response.md) |
| **GDPR Ch. V** — international transfers | Primary data stays in the EU (Frankfurt). The transfer of an analysis photograph to the US vision provider relies on SCCs and the EU–US Data Privacy Framework where the provider is certified. The help assistant's transfer to OpenRouter (US) has **no established basis** yet | Partial — see note | [sub-processors.md](sub-processors.md) |
| **ePrivacy Art. 5(3)** — cookies and device storage | Consent banner with Reject on the same layer, at equal prominence, as Accept; nothing optional loads before consent; withdrawal as easy as consent | Implemented, unit tested | `src/lib/compliance/consent.ts` |

**Transfer note.** The Data Privacy Framework is valid law: the EU General Court upheld it on
3 September 2025 (*Latombe v Commission*, T-553/23). The appeal lodged on 31 October 2025 is
pending before the Court of Justice (Case C-703/25 P); no judgment was found when this was
re-checked on 2026-11-25. The Court of Justice invalidated both of the framework's predecessors,
so SCCs are kept as the fallback basis rather than relying on the framework alone.

**Item found 2026-09-24 (DEF-066).** Both clients send inspection coordinates to OpenStreetMap's
Nominatim service for reverse geocoding, and at sign-up both clients query the Pwned Passwords range API.
Neither offers a processing agreement. Both are listed under
[third-party services](sub-processors.md#third-party-services-without-a-processing-agreement), and
as of 2026-11-25 the privacy policy's "Who we share it with" section (`src/content/privacy-policy.json`)
names both and says what each receives. What stays open is the lack of a processing agreement:
the geocoder is to be replaced by a self-hosted or contracted one before use at scale.

## 4. Privacy — United States

| Law | What EquipCert does | Status |
|---|---|---|
| **State comprehensive privacy laws** (California CCPA/CPRA among roughly twenty states with laws in effect in 2026; counts differ by source) | Rights request intake, no sale or sharing of personal data, no targeted advertising, no analytics or tracking scripts at all | Implemented |
| **Global Privacy Control** — honoured as an opt-out in California, Colorado, Connecticut, Delaware, Maryland, Minnesota, Montana, Nebraska, New Hampshire, New Jersey, Oregon and Texas | GPC is detected and applied; from 1 Jan 2026 California requires a *visible* confirmation, so an "Opt-Out Preference Signal Honored" notice renders | Implemented |
| **Applicability thresholds** | Most state laws apply above revenue or data-volume thresholds. As a B2B processor, EquipCert's obligations reach it mainly through customer contracts (service-provider terms) | Partial — contract templates are on the roadmap |
| **COPPA** | The service is not directed at children and does not knowingly collect their data | Not applicable |
| **FTC Act §5** — deceptive practices | Capacity and uptime are published as *design targets per tier*, never as current guarantees ([SCALING.md](../SCALING.md), [AVAILABILITY.md](../AVAILABILITY.md)); no certification is claimed | Implemented as a documentation rule |

## 5. Artificial intelligence

| Law | What EquipCert does | Status |
|---|---|---|
| **EU AI Act — classification** | Not high-risk: not an Annex III use, and not a safety component under Art. 6(1) — it is not part of a product covered by Annex I harmonisation legislation requiring third-party conformity assessment; it is a record-keeping application used alongside separately certified equipment | Documented — [ai-act-classification.md](ai-act-classification.md) |
| **EU AI Act Art. 50(1)** — transparency (applies from 2 Aug 2026; not changed by the Digital Omnibus on AI) | Inspection analysis: AI-derived results are disclosed to the inspector before signing, and provenance is recorded server-side. Help assistant: states that it is an AI, what it can and cannot do, and where questions go, before the first question, on web and mobile | Implemented |
| **EU AI Act Art. 50(2)** — machine-readable marking (2 Aug 2026; 2 Dec 2026 for systems already on the market before 2 Aug 2026, under the Digital Omnibus on AI) | Inspection PDF reports carry the marking in document metadata; a real-render unit test reads it back. Help assistant answers are labelled as AI output on screen and flagged `aiGenerated`, with the model id, in the API response; the answer text itself carries no embedded mark | Implemented for the PDF; Partial for the assistant, see the [memo](ai-act-classification.md) §9 |
| **EU AI Act: help assistant classification** | A chatbot built on general-purpose models. It answers questions about using the product, cannot change data and makes no safety decision. Not high-risk | Documented — [ai-act-classification.md](ai-act-classification.md) §9 |
| **Model provider choice** | The provider is a configuration value; changing it is a sub-processor change and updates the privacy documents first | Documented |

## 6. Cybersecurity regulation

| Law | Applies? | What EquipCert does | Status |
|---|---|---|---|
| **EU Cyber Resilience Act** | **The Flutter mobile app is a product with digital elements** once it is made available on the EU market; its backend is likely in scope as the app's remote data processing solution. Pure SaaS is generally excluded. Reporting duties apply from **11 Sep 2026**, to products already on the market too; full essential requirements from **11 Dec 2027**. Reporting timeline: 24 h early warning, 72 h notification, final report 14 days after a fix is available (exploited vulnerabilities) or one month (severe incidents) | Coordinated vulnerability disclosure policy ([SECURITY.md](../../SECURITY.md)); dependency scanning in CI. The app is not yet published to any store, so it has not been made available on the EU market. ENISA's Single Reporting Platform went live on 11 Sep 2026 and is the channel for these reports | Partial — SBOM, an ENISA single-reporting-platform runbook (24 h / 72 h / 14 days) and conformity documentation are [planned](../ROADMAP.md) before store release |
| **EU NIS2 Directive** | Cloud and SaaS providers fall in its sectors, but only from medium size under the EU SME definition — 50 or more staff, or both annual turnover and balance sheet above €10M | Below the size cap. Customers that are in scope may pass supply-chain security terms down contractually | Not applicable today — changes on crossing the threshold |
| **GDPR Art. 32** | Yes | See §3 | Partial |

## 7. Accessibility

| Law | Applies? | Status |
|---|---|---|
| **ADA Title III** (US private businesses) | No federal web rule, and courts are split on when a website alone is covered; where it is, **WCAG 2.1 AA** is the usual benchmark. An automated axe suite (WCAG 2.0–2.2 A/AA rules) runs in Playwright on the main pages at desktop and phone width (`e2e/browser/`). Automated checks find only part of what an audit would | Partial — see [ACCESSIBILITY.md](../ACCESSIBILITY.md) |
| **ADA Title II** (state and local government) | Applies to *customers* such as municipal fire departments, whose web content and apps must meet **WCAG 2.1 AA** by 26 Apr 2027 (population 50,000 or more) or 26 Apr 2028 (smaller entities and special districts), as extended by the Department of Justice's interim final rule of 20 Apr 2026. Vendors are asked to prove it at procurement | Partial — no third-party audit yet; one is planned |
| **European Accessibility Act** | Purely B2B services are outside its scope, and microenterprises are exempt from the service requirements | Not applicable today; WCAG 2.1 AA / EN 301 549 is still the target |

## 8. Billing

| Topic | What EquipCert does | Status |
|---|---|---|
| **Subscription billing** | Built and connected to Stripe: Stripe-hosted checkout and customer portal (`api/billing/checkout.ts`, `api/billing/portal.ts`), seat synchronisation (`api/billing/seats.ts`) and a signature-verified webhook (`api/webhooks/stripe.ts`). An organisation's plan and Stripe identifiers change only through verified billing events; the database refuses those changes from a customer session (DEF-077). Each webhook event id is recorded in `billing_events`, so a repeated delivery is detected and skipped; a concurrent duplicate is harmless because every write sets the current Stripe state | Implemented |
| **Live payments** | **Not enabled.** The server refuses a live Stripe key unless the operator explicitly allows live keys. Live payments are switched on when the operator enables live keys; until then no payment is taken and no card is charged. Enabling them is a sub-processor activation that needs the [sub-processor list](sub-processors.md) and the privacy policy reviewed first | Not applicable until the operator enables live keys |
| **Card data** | Card details are entered on Stripe's own pages. The browser does not load Stripe.js, and card numbers never reach EquipCert's systems | Implemented by design |

## 9. Open items and what is not claimed

Open items that only the operator can close:

- **Counsel review and the operator's legal identity.** The policies and these documents carry
  placeholders such as [CONTROLLER LEGAL NAME]. Nothing here has been reviewed by counsel.
- **OpenRouter** needs a signed DPA (or a replacement provider), routing restricted to providers
  that do not retain prompts, and a recorded transfer basis before the help assistant is used with
  real customer data.
- **CAPTCHA is off** on sign-in and sign-up, so credential stuffing is only rate limited
  ([SECURITY-MODEL.md](../SECURITY-MODEL.md)).
- **Authentication email uses the hosting platform's shared sender**, which is capped at a few
  messages per hour; a custom SMTP sender is not yet configured.
- **The mobile app is not in any store**, so the Cyber Resilience Act work in §6 is still ahead.
- **No third-party penetration test** and **no third-party WCAG audit** have been carried out.

Not claimed:

- **No certification** — not SOC 2, not ISO 27001, not a HIPAA attestation. Readiness work is on
  the roadmap; claiming any of these before an auditor has signed would be false.
- **No legal review.** Every document in this folder states a position and its reasoning. Counsel
  review is an open [roadmap](../ROADMAP.md) item.
- **No uptime guarantee.** The Terms of Service say there is no SLA; see [AVAILABILITY.md](../AVAILABILITY.md).

---

## Sources

Re-checked 2026-11-25:

- Digital Omnibus on AI: published in the Official Journal on 24 Jul 2026, in force 27 Jul 2026;
  Art. 50(2) marking due 2 Dec 2026 for systems on the market before 2 Aug 2026; Art. 50(1)
  unchanged — <https://www.lewissilkin.com/insights/2026/07/27/the-digital-omnibus-on-ai-enters-into-force-today>,
  <https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/>
- CRA Single Reporting Platform launched, manufacturers' reporting obligations applying from
  11 Sep 2026, main requirements from 11 Dec 2027 — <https://www.enisa.europa.eu/news/the-cra-single-reporting-platform-is-launched>
- ADA Title II compliance dates (26 Apr 2027 / 26 Apr 2028), 28 CFR 35.200(b) as amended —
  <https://www.govinfo.gov/content/pkg/FR-2026-04-20/html/2026-07663.htm>
- EU–US Data Privacy Framework appeal, Case C-703/25 P (no judgment found) —
  <https://eur-lex.europa.eu/eli/C/2025/6610/oj>

Checked 2026-09-24 and not re-checked in this review:

- OSHA 29 CFR 1910.157 — <https://www.law.cornell.edu/cfr/text/29/1910.157>
- EU Cyber Resilience Act reporting — <https://www.kirkland.com/publications/kirkland-alert/2026/09/the-eu-cyber-resilience-act>,
  <https://www.dlapiper.com/en/insights/publications/2026/02/cyber-resilience-act-the-fine-line-between-saas-and-digital-products>
- European Accessibility Act scope — <https://www.webyes.com/blogs/eaa-exemptions/>
- NIS2 size cap for cloud providers — <https://nisd2.eu/en/wiki/scope/am-i-cloud-provider-nis2>
- ESIGN / UETA — <https://www.docusign.com/products/electronic-signature/learn/esign-act-ueta>
- eIDAS Art. 25 — <https://ec.europa.eu/digital-building-blocks/sites/spaces/DIGITAL/pages/880312429/eSignature+FAQ>
- EU adequacy decision for the UK, renewed to 2031 — <https://www.hunton.com/privacy-and-information-security-law/european-commission-renews-uk-data-adequacy-decisions>
- EU–US Data Privacy Framework — <https://iapp.org/news/a/european-general-court-dismisses-latombe-challenge-upholds-eu-us-data-privacy-framework>,
  <https://www.wilmerhale.com/en/insights/blogs/wilmerhale-privacy-and-cybersecurity-law/20251201-european-court-of-justice-to-review-challenge-to-eu-us-data-privacy-framework>
- US state privacy laws in 2026 — <https://www.multistate.us/insider/2026/2/4/all-of-the-comprehensive-privacy-laws-that-take-effect-in-2026>
- AI Act Art. 50 — <https://artificialintelligenceact.eu/transparency-rules-article-50/>
- Global Privacy Control, 2026 CCPA regulations — <https://www.gtlaw.com/en/insights/2025/9/revised-and-new-ccpa-regulations-set-to-take-effect-on-jan-1-2026-summary-of-near-term-action-items>

Laws change. Re-check each source before relying on a row, and update the review date above.
