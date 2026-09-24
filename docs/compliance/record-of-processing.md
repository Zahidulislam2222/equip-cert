# Record of processing activities (GDPR Art. 30)

**Controller:** [CONTROLLER LEGAL NAME]
**Address:** [CONTROLLER REGISTERED ADDRESS]
**Contact:** [PRIVACY CONTACT EMAIL]
**EU Art. 27 representative:** [EU REPRESENTATIVE, IF THE CONTROLLER IS NOT ESTABLISHED IN THE EU]
**Data Protection Officer:** none appointed — reasoning in §6
**Version:** 2026-09-10

Article 30 requires this record in writing, and requires it to be produced to a supervisory
authority on request. The Art. 30(5) small-organisation exemption is narrow and does not apply
here: the processing is not occasional, and it is not the kind of one-off activity the exemption
contemplates.

This is the document a regulator asks for first. Writing it after an incident is writing it too
late.

---

## 1. Processing activities

### 1.1 Account and organisation management

| | |
|---|---|
| **Purpose** | Authenticate users, place them in their organisation, assign roles, record the qualifications that let someone sign an inspection |
| **Categories of data subject** | Technicians, managers, administrators |
| **Categories of personal data** | Name, email address, role, qualifications, organisation membership, password hash, sign-in events |
| **Legal basis** | Art. 6(1)(b) performance of a contract |
| **Recipients** | Supabase (hosting, EU); at sign-up and password change the web client queries the Pwned Passwords range API (the user's IP address and the first five characters of the password's SHA-1 hash — no DPA; added 2026-09-24) |
| **Third-country transfer** | None for stored data. The breached-password query reaches a third-party public API outside our control |
| **Retention** | Life of the account, then deleted within 30 days of closure |
| **Security measures** | §5 |

### 1.2 Inspection records

| | |
|---|---|
| **Purpose** | Create, store and produce safety equipment inspection records |
| **Categories of data subject** | The technician who performs the inspection; any person named in a record |
| **Categories of personal data** | Technician name and qualifications, digital signature, GPS coordinates of the inspection, timestamps, photographs of equipment (which may incidentally show a person) |
| **Legal basis** | Art. 6(1)(b); Art. 6(1)(c) where a record-keeping duty applies |
| **Recipients** | The customer organisation's own managers and admins; Supabase; OpenStreetMap Foundation (Nominatim) receives the GPS coordinates to return an address, under its public usage policy with no processing agreement — added 2026-09-24, DEF-066; a regulator on lawful request |
| **Third-country transfer** | None for the stored record. The coordinate lookup goes to a UK-based service (EU adequacy decision for the UK, renewed to 2031); where requests are served from is not verified |
| **Retention** | One year after the last entry, or the life of the extinguisher shell, whichever is shorter — 29 CFR 1910.157(e)(3). Longer only where a specific fire code or the customer's own retention instruction requires it |
| **Security measures** | §5. Signed records are immutable: RLS forbids UPDATE and DELETE |

**Note on the retention period.** An earlier version of the public privacy policy claimed five
years under 29 CFR 1904.33. That was a misapplied citation — 1904.33 governs OSHA injury and
illness logs, a different record entirely. Keeping personal data five times longer than required
is a storage limitation failure under Art. 5(1)(e), not prudence. Corrected here and in the
policy.

### 1.3 AI-assisted equipment analysis

| | |
|---|---|
| **Purpose** | Pre-fill an inspection checklist with a suggested equipment type, serial number and condition |
| **Categories of data subject** | Any person incidentally visible in an equipment photograph |
| **Categories of personal data** | The photograph submitted for analysis |
| **Legal basis** | Art. 6(1)(b) — the technician confirms or corrects every suggestion before signing |
| **Recipients** | The configured vision model provider (default: Google) |
| **Third-country transfer** | **Yes — United States.** SCCs; EU–US Data Privacy Framework where the provider is certified |
| **Retention** | Not retained by us for this purpose. The photograph is stored as inspection evidence under 1.2; the provider's own retention is governed by its API terms |
| **Automated decision-making** | **No.** Art. 22 is not engaged: the model proposes, a qualified human decides and signs. See `docs/compliance/ai-act-classification.md` |

### 1.4 Consent records

| | |
|---|---|
| **Purpose** | Demonstrate that consent was given, for what, and against which version of the notice — Art. 7(1) |
| **Categories of data subject** | Anyone who answers the cookie banner |
| **Categories of personal data** | User id where signed in, purpose, granted/withdrawn, document version, timestamp, method |
| **Legal basis** | Art. 6(1)(c) — a legal obligation to be able to demonstrate consent |
| **Retention** | While the consent is relied on, plus the limitation period |
| **Note** | IP address is **omitted rather than fabricated**. The static export cannot observe the client address, and writing a placeholder into an evidentiary record would make the record worse than leaving the field null |

### 1.5 Data subject requests

| | |
|---|---|
| **Purpose** | Receive, verify, track and answer rights requests within the statutory deadline |
| **Categories of data subject** | Anyone who files a request, including people with no account |
| **Categories of personal data** | Email address, request type, free-text message, verification method, handling history |
| **Legal basis** | Art. 6(1)(c) — a legal obligation to respond |
| **Retention** | Two years from completion, to evidence that the deadline was met |
| **Deadline** | Computed by the database on insert: one month (Art. 12(3)) or 45 days (US state laws) |

### 1.6 Security and abuse prevention

| | |
|---|---|
| **Purpose** | Rate limiting, detecting credential abuse, investigating a suspected compromise |
| **Categories of personal data** | IP address, request timing, authentication events |
| **Legal basis** | Art. 6(1)(f). **Balancing test:** the interest is the security of the service and of other users' data; the processing is minimal, short-lived, and not used to profile anyone or make any decision about them; a data subject would reasonably expect a service to defend itself. The interest is not overridden |
| **Retention** | Rate-limit counters are in memory only and expire with the window. Authentication events: 12 months |

---

## 2. Categories of data subject, consolidated

Technicians; managers and administrators; anyone incidentally photographed during an inspection;
anyone who files a data subject request; visitors to the public site.

## 3. Special category data (Art. 9)

**None is processed intentionally.** The residual risk is a photograph that incidentally captures
a person in a way that reveals something protected. The mitigation is instruction rather than
technology: technicians photograph equipment, not people. This is stated here as a known residual
risk rather than as a solved problem.

## 4. Children's data

Not processed. The product is used by qualified technicians at work.

## 5. Technical and organisational measures (Art. 32)

- TLS in transit; encryption at rest by the hosting platform
- Row Level Security on every table, FORCEd on all but one, so authorization is enforced by
  Postgres regardless of application code. Verified against the **live** database by
  `npm run test:rls-policies`, not against the migrations
- Signed inspection records cannot be updated or deleted by any application role
- Evidence photographs and signatures in private storage, reachable only by short-lived signed URL
- Content Security Policy with no `unsafe-eval`, plus `object-src 'none'`, `base-uri 'self'` and
  `form-action 'self'`; HSTS
- Auth posture held to a versioned baseline and asserted by `npm run test:auth-config`
- Rate limiting on the AI endpoint and on the privacy request endpoint
- Service-role credentials never leave server handlers and are never `NEXT_PUBLIC_`
- Secret scanning (gitleaks) and SAST (bandit, semgrep) on every commit

- *(Built and e2e-tested; migration `20260914000100` not yet applied to the hosted database as of
  2026-09-24 — until it is, the measures in this bullet describe the target state.)*
  Append-only audit log of security- and compliance-relevant **changes** (inspections, corrective
  actions, membership and roles, organisation plan and retention, equipment, privacy requests,
  consent), written by database triggers in the same transaction as the change. Entries hold the
  acting account, the subject account where relevant, and the changed column names, never names,
  emails or free text; clients cannot insert; no application role (anon, authenticated, service_role) can edit an entry — the only permitted
  UPDATE removes personal references, and DELETE happens only in the cascade from deleting the
  organisation. The database owner role used for migrations and the SQL editor can disable the
  append-only trigger: that is operator access outside the application, not a client path, and is
  restricted to authorised personnel. Erasure removes the subject's account reference (as actor and as subject) and
  address from entries through that redaction shape (DEF-059). Verified by `e2e/audit-log.test.mjs`

**Honestly stated limitations.** READS of personal data are not logged — the audit log records
changes, not views. On the free hosting plan a refresh token does not expire on its own. The
current deployment is a single server with no redundancy, so no availability figure is claimed;
`docs/AVAILABILITY.md` states design targets for a redundant deployment, labelled as such. Breached-password checking runs client-side rather than being enforced at the
authentication server. Each of these is tracked; none is described here as done.

## 6. Why no Data Protection Officer

Art. 37(1) requires a DPO where the controller is a public authority, or where core activities
consist of regular and systematic monitoring of data subjects on a large scale, or of large-scale
processing of Art. 9 or Art. 10 data. None applies: the controller is private, there is no
monitoring of individuals, and no special-category processing. Recorded as a reasoned position so
that it reads as a decision rather than an omission.

---

*This record states a position and its reasoning. It is not legal advice and has not been
reviewed by counsel. [CONTROLLER LEGAL NAME] should have it reviewed before relying on it.*
