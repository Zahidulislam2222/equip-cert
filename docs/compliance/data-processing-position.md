# Controller / processor position, and the DPA

**Controller:** [CONTROLLER LEGAL NAME]
**Version:** 2026-11-25 (first issued 2026-09-10; reviewed 2026-11-25 for invitations, billing,
e-sign consent evidence, member removal and the help assistant)

Every enterprise customer's legal review asks the same two questions before it asks anything
else: *which of us is the controller of what*, and *where is your DPA*. Getting the first one
wrong makes the second one unsignable, so this document answers them in that order.

---

## 1. The split

It is not one relationship. It is two, running at the same time over different data.

| Data | Controller | Our role | Why |
|---|---|---|---|
| **Inspection records** — checklist answers, photographs, signatures, GPS, the named technician | **The customer organisation** | **Processor** | They decide which equipment is inspected, when, by whom, and how long the record is kept. Those are the purposes and means. We supply the tool |
| **Account data** — name, email, role, qualifications, authentication | **Us** | **Controller** | We decide how authentication works, what a role means, and how long an account survives closure. The customer cannot change those |
| **Security and abuse data** — IP addresses, rate-limit state, sign-in events | **Us** | **Controller** | We decide to defend the service, in our own legitimate interest |
| **Consent and privacy request records** | **Us** | **Controller** | Our own Art. 7(1) and Art. 12 obligations, which a customer cannot discharge for us |
| **Organisation invitations** — role offered, issuing and accepting account ids, times; no name or email | **Us** | **Controller** | Part of account management: we decide how membership works, how long a link is valid and that it is single-use |
| **E-signature consent evidence** — consent given, wording version, server time | **Us**, as the privacy policy states | **Controller** | We set the wording and the rule that a record cannot be signed without it. It also supports the customer's own signed records, so the customer may have an interest in it as well; whether this is better treated as joint or processor data is a point for counsel |
| **Billing data** — billing contact email, organisation name, Stripe customer and subscription ids, billing event ids | **Us** | **Controller** | Our contract, our tax obligation |
| **Help assistant questions** | **Us** | **Controller** | We decide to offer the assistant, in our legitimate interest in helping users use the product |
| **Help assistant organisation summary** — counts, equipment names, due dates read from the customer's records | **The customer organisation** | **Processor** | It is drawn from the customer's records, on a member's request, to answer that member. Sending it to OpenRouter makes OpenRouter a sub-processor of customer data, which is why the open item in §3 matters |

**Why the inspection-record line is drawn there.** The tempting alternative — claiming controller
status over everything because the data sits in our database — is wrong, and it is wrong in the
direction that costs the customer. Art. 4(7) turns on who determines purposes and means, not on
who holds the bytes. A customer that decides its own inspection schedule and its own retention is
determining both.

**The consequence people miss.** A processor may not decide, on its own, to delete a customer's
inspection records because a technician asked. Art. 28(3)(e) requires us to *assist* the
controller; it does not authorise us to act instead of them. So a rights request touching
inspection records is routed to the customer organisation, and the privacy request form and queue
are built that way — the admin who sees the request is an admin of the tenant that owns the data.

**Removing a member is the customer's instruction, not an erasure.** When an administrator removes
a member, the member's account row is deleted and the link from their signed records to that
account is cleared; the name, the signature and the rest of each signed record stay, because the
customer keeps its records for its retention period (migration `20261125000300`). Erasing the
person from those records is a separate act: a verified rights request, carried out by
`erase_subject` (service role only, live since 2026-10-01).

**Where we would become a controller by accident.** If we ever used inspection data for our own
purposes — training a model on customer photographs, product analytics, anything not instructed
by the customer — we would become a controller of that processing under Art. 28(10), with every
obligation that follows and no lawful basis prepared for it. We do not, and any proposal to do so
is a legal change before it is a technical one.

---

## 2. What the DPA has to contain (Art. 28(3))

A processor may only act on documented instructions, and the contract must be in writing and must
set out:

| Requirement | Our position |
|---|---|
| Subject matter, duration, nature and purpose, type of data, categories of data subject | In the DPA schedule, mirroring `record-of-processing.md` |
| Process only on documented instructions, including on transfers | Yes. Two transfers of customer data leave the EU: the analysis photograph to the vision provider, and — only when a member asks the help assistant about their organisation — the organisation summary to OpenRouter. Both are disclosed in `sub-processors.md`; the second has no transfer basis yet (§3) |
| Confidentiality commitments from personnel | [TO BE CONFIRMED BY THE CONTROLLER] |
| Art. 32 security measures | `record-of-processing.md` §5, including its stated limitations |
| Sub-processor authorisation and notice of changes | `sub-processors.md` is the authorised list; changes are notified before they take effect |
| Assist with data subject rights | The privacy request intake and admin queue are that assistance, built rather than promised; erasure (`erase_subject`) is live on the hosted database |
| Assist with Arts. 32–36 — security, breach, DPIA | `breach-response.md`; we notify the controller without undue delay under Art. 33(2) |
| Delete or return data at the end of the contract | Export then delete. Note the tension in §3 |
| Make information available and allow audits | Yes, including this documentation set and the live-posture gates, which are re-runnable by a reviewer |

---

## 3. The honest tensions

**Deletion versus retention.** Art. 28(3)(g) says delete or return at the end of the contract.
Fire safety records have their own retention rules and the customer may have insurance or
contractual reasons to keep them. The contract has to say which wins, per record type, before it
is signed — not after a customer leaves and asks for everything to be destroyed.

**Standard contractual clauses run in both directions.** For the US vision provider we are the
data exporter. For a customer outside the EEA sending data into our EU database, they may need
their own basis. A DPA that only addresses our export is half a DPA.

**The help assistant reaches a sub-processor that is not yet cleared.** OpenRouter has no signed
processing agreement, no verified retention terms and no recorded transfer basis, and free-model
providers may retain prompts. Until that is closed — a signed DPA or a replacement provider,
routing restricted to providers that do not retain prompts, and the transfer basis recorded in
`sub-processors.md` — the assistant must not be used with real customer data, and a customer's
DPA cannot list it as an authorised sub-processor. This is an owner action.

**We do not have a signed DPA template yet.** That is the actual status, and it is written here
rather than implied by the existence of this document. It requires counsel and the controller's
legal identity, both of which are open. The purpose of this file is to make sure that when it is
drafted, it is drafted against a controller/processor split that has already been reasoned through
— because that split is the part that is expensive to get wrong and cheap to get right now.

**No SOC 2 or ISO 27001 report exists.** Enterprise reviews ask for one. The answer is no, plus
this documentation set and the gates that verify the live system, which is a weaker answer
honestly given rather than a stronger one implied.

---

*This document states a position and its reasoning. It is not legal advice, it is not a data
processing agreement, and it has not been reviewed by counsel.*
