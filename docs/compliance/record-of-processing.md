# Record of processing activities (GDPR Art. 30)

**Controller:** [CONTROLLER LEGAL NAME]
**Address:** [CONTROLLER REGISTERED ADDRESS]
**Contact:** [PRIVACY CONTACT EMAIL]
**EU Art. 27 representative:** [EU REPRESENTATIVE, IF THE CONTROLLER IS NOT ESTABLISHED IN THE EU]
**Data Protection Officer:** none appointed — reasoning in §6
**Version:** 2026-11-25 (first issued 2026-09-10; reviewed 2026-11-25 against the code and the
hosted database, with activities 1.7 to 1.10 added)

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
| **Recipients** | Supabase (hosting, EU); at sign-up, both the web and mobile clients query the Pwned Passwords range API (the user's IP address and the first five characters of the password's SHA-1 hash — no DPA; added 2026-09-24) |
| **Third-country transfer** | None for stored data. The breached-password query reaches a third-party public API outside our control |
| **Retention** | Life of the account, then deleted within 30 days of closure |
| **Security measures** | §5. A new organisation and its first administrator are created together in one database transaction (`provision_account`); nobody can insert an organisation or a member row directly, and an existing organisation can be joined only through an invitation (1.8). The plan's seat limit is enforced in the database |

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
| **Security measures** | §5. Signed records are immutable: nobody can delete one, and a database trigger rejects every UPDATE except the two exact shapes described below. The record time is set by the server; a client cannot backdate or postdate it |

**Note on the retention period.** An earlier version of the public privacy policy claimed five
years under 29 CFR 1904.33. That was a misapplied citation — 1904.33 governs OSHA injury and
illness logs, a different record entirely. Keeping personal data five times longer than required
is a storage limitation failure under Art. 5(1)(e), not prudence. Corrected here and in the
policy.

**When a member leaves.** The two permitted changes to a signed record both concern the person,
never the finding:

- **Removal by an administrator** deletes the member's account row. The database clears the
  record's link to that account (`inspector_id`) and changes nothing else: the signer's name, the
  signature and every other field stay, because the customer organisation, as controller, keeps
  the record for its retention period (migration `20261125000300`). Any change of that kind made
  while the account still exists is refused.
- **Erasure under Art. 17** (`erase_subject`, service role only, after identity verification)
  replaces the name with a redaction label and removes the link, the GPS coordinates and the device
  details, keeping the safety finding. See [data-processing-position.md](data-processing-position.md).

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
| **Purpose** | Show that consent was given, for what, and against which version of the notice — Art. 7(1) |
| **Categories of data subject** | Anyone who answers the cookie banner |
| **Categories of personal data** | User id where signed in, purpose, granted/withdrawn, document version, timestamp, method |
| **Legal basis** | Art. 6(1)(c) — a legal obligation to be able to prove consent |
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
| **Categories of personal data** | IP address, account id, request timing, authentication events |
| **Legal basis** | Art. 6(1)(f). **Balancing test:** the interest is the security of the service and of other users' data; the processing is minimal, short-lived, and not used to profile anyone or make any decision about them; a data subject would reasonably expect a service to defend itself. The interest is not overridden |
| **Retention** | Rate-limit counters (AI analysis, help assistant, billing and privacy request endpoints) expire with their window. In the default configuration they are held in the server's memory; a shared store can be configured, and enabling one would add it to the [sub-processor list](sub-processors.md). Authentication events: 12 months |

### 1.7 E-signature consent evidence

| | |
|---|---|
| **Purpose** | Keep evidence that a person agreed to sign electronically, and to which wording, before they signed an inspection record (US ESIGN Act, 15 U.S.C. §7001(c); UETA) |
| **Categories of data subject** | Technicians and other members who sign inspection records |
| **Categories of personal data** | On the person's account: that consent was given, the version of the consent wording shown (`src/content/esign-consent.json`), and the time — always the server's clock |
| **Legal basis** | Art. 6(1)(c) where a legal duty to keep that evidence applies, otherwise Art. 6(1)(f) — matching the privacy policy |
| **Recipients** | Supabase; the organisation's own managers and administrators |
| **Third-country transfer** | None |
| **Retention** | Held on the account and deleted with it — when an administrator removes the member, when the account is closed, or on erasure. A signed record that outlives the account keeps the signer's name and signature but not the consent time and version; that gap is recorded in the [legal map](README.md) |
| **Security measures** | Only the person signing can record their own consent; an administrator cannot record it for them. A client-supplied time is overwritten. Once recorded, consent cannot be cleared by editing the account. The database refuses a signed inspection unless it is filed by the inspector it names and that person has consent and a wording version on record (migrations `20261125000100`, `20261125000200`) |

### 1.8 Organisation invitations

| | |
|---|---|
| **Purpose** | Let an administrator add a person to their organisation through a single-use, expiring link, without anyone joining a tenant uninvited |
| **Categories of data subject** | The administrator who issues an invitation; the person who accepts it |
| **Categories of personal data** | In `organization_invites`: the role offered (never administrator), the issuing and accepting members' account ids, and when the invitation was created, expires, was accepted or was revoked. **No name or email address is stored.** The link token is 192 random bits and only its SHA-256 hash is kept; the token itself is shown once, to the administrator who created it, who shares it by whatever means they choose. Issuing and revoking are written to the audit log, without the token or any contact details. The accepting person's name comes from their own sign-up details |
| **Legal basis** | Art. 6(1)(b) — performance of the contract with the customer organisation |
| **Recipients** | Supabase. Managers and administrators of the same organisation can see the invitation list, but not the token hash |
| **Third-country transfer** | None |
| **Retention** | An invitation is valid for 168 hours by default (configurable; the database accepts 1 to 720 hours) and can be used once. Expired, used and revoked invitations are not purged automatically: they are kept for the life of the organisation and deleted with it; the account ids become empty when the account they point to is deleted. A shorter retention period for closed invitations is not yet set |
| **Security measures** | Only an administrator can create or revoke an invitation; the table cannot be written directly; accepting is one transaction that checks the hash, expiry and single use, gives the same answer for an unknown, expired, revoked or used link, and enforces the plan's seat limit |

### 1.9 Billing

| | |
|---|---|
| **Purpose** | Sell and manage subscriptions, keep the paid seat count in line with the organisation's members, and apply plan changes that Stripe reports |
| **Categories of data subject** | The administrator who starts a checkout or opens the billing portal |
| **Categories of personal data** | Sent to Stripe when a billing customer is created: the organisation name, the administrator's email address, and the organisation id. Stored by EquipCert: the Stripe customer and subscription ids on the organisation, and in `billing_events` each Stripe event id, its type, the organisation id and the time it was received. Card details are entered on Stripe's own pages and never reach EquipCert |
| **Legal basis** | Art. 6(1)(b); Art. 6(1)(c) for records that tax law requires |
| **Recipients** | Stripe. Managers and administrators can read their own organisation's billing events; only the server writes them |
| **Third-country transfer** | Stripe processes in the United States and the EU — SCCs; EU–US Data Privacy Framework |
| **Retention** | Payment records as tax law requires. `billing_events` rows are kept so a repeated delivery is never applied twice; if the organisation is deleted the row keeps no link to it |
| **Status** | Built and connected to Stripe. **Live payments are not enabled:** the server refuses a live Stripe key unless the operator explicitly allows live keys. Live payments are switched on when the operator enables live keys; until then no payment is taken and no card is charged |

### 1.10 In-app help assistant

| | |
|---|---|
| **Purpose** | Answer questions about using the product (`api/assist.ts`) |
| **Categories of data subject** | Signed-in members who use the assistant; members whose work appears in an organisation summary only as counts |
| **Categories of personal data** | The question and a bounded number of earlier turns, as typed by the user. Only when the question asks about the user's own organisation: a read-only summary of its records — counts, up to five equipment names with due dates, the plan and its usage — read under the user's own row-level security. No names or email addresses are added by EquipCert |
| **Legal basis** | Art. 6(1)(f), matching the privacy policy. **Balancing test:** the interest is helping users use the product; the assistant is optional, says before the first question what it sends and where, and asks users not to type personal or confidential details; nothing it produces is used to make any decision about a person. The interest is not overridden — provided the open transfer item below is closed before real customer data is used |
| **Recipients** | OpenRouter, Inc., and the upstream provider of the free model it routes to |
| **Third-country transfer** | **Yes — United States** (OpenRouter); the upstream provider's location depends on the model. **No transfer basis is established yet** and no processing agreement is signed; see [sub-processors.md](sub-processors.md) |
| **Retention** | EquipCert does not store the conversation; the web panel and the mobile app hold it in memory until it is closed or restarted, and the server logs only model failures, never the question. The retention of OpenRouter and of free-model providers is governed by their own terms and has not been verified |
| **Automated decision-making** | **No.** The assistant cannot change data or act for the user, and gives no verdict on equipment. See [ai-act-classification.md](ai-act-classification.md) §9 |

---

## 2. Categories of data subject, consolidated

Technicians; managers and administrators, including the administrator who acts as billing
contact; people invited to join an organisation; anyone incidentally photographed during an
inspection; anyone who files a data subject request; visitors to the public site.

## 3. Special category data (Art. 9)

**None is processed intentionally.** The residual risk is a photograph that incidentally captures
a person in a way that reveals something protected. The mitigation is instruction rather than
technology: technicians photograph equipment, not people. This is stated here as a known residual
risk rather than as a solved problem.

## 4. Children's data

Not processed. The product is used by qualified technicians at work.

## 5. Technical and organisational measures (Art. 32)

- TLS in transit; encryption at rest by the hosting platform
- Row Level Security on all 13 tables, FORCEd on 12 (the exception, `plan_limits`, is shared
  read-only reference data), so authorization is enforced by Postgres regardless of application
  code. Verified against the **live** database by `npm run test:rls-policies`, not against the
  migrations. All 11 migrations were applied to the hosted database by 2026-11-25
- Signed inspection records cannot be deleted, and cannot be updated except by the two exact,
  trigger-checked changes described under 1.2
- Inspection record times are set by the server: a trigger overwrites any `created_at` a client sends
  (other tables, including consent records, use a database default that a client could override —
  an open item on the roadmap)
- Tenancy: organisations and members cannot be inserted directly; a profile cannot be moved
  between organisations; only an administrator can change a role, and never their own; the plan
  and billing identifiers change only through verified billing events; the seat limit is
  enforced in the database
- Evidence photographs and signatures in private storage, reachable only by short-lived signed URL
- Content Security Policy with no `unsafe-eval`, plus `object-src 'none'`, `base-uri 'self'` and
  `form-action 'self'`; HSTS
- Auth posture held to a versioned baseline and asserted by `npm run test:auth-config`
- Rate limiting on the AI analysis endpoint, the help assistant, the billing endpoints and the
  privacy request endpoint
- Service-role credentials never leave server handlers and are never `NEXT_PUBLIC_`
- Secret scanning (gitleaks) and SAST (bandit, semgrep) on every commit

- *(Migration `20260914000100` applied to the hosted database on 2026-10-01 and e2e-tested there.)*
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
`docs/AVAILABILITY.md` states design targets for a redundant deployment, labelled as such.
Breached-password checking runs client-side rather than being enforced at the authentication
server. CAPTCHA is off on sign-in and sign-up. Authentication email goes through the hosting
platform's shared sender, which is capped at a few messages per hour. The help assistant's
provider has no processing agreement yet (1.10). No third-party penetration test has been carried
out. Each of these is tracked; none is described here as done.

## 6. Why no Data Protection Officer

Art. 37(1) requires a DPO where the controller is a public authority, or where core activities
consist of regular and systematic monitoring of data subjects on a large scale, or of large-scale
processing of Art. 9 or Art. 10 data. None applies: the controller is private, there is no
monitoring of individuals, and no special-category processing. Recorded as a reasoned position so
that it reads as a decision rather than an omission.

---

*This record states a position and its reasoning. It is not legal advice and has not been
reviewed by counsel. [CONTROLLER LEGAL NAME] should have it reviewed before relying on it.*
