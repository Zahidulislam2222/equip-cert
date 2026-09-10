# Personal data breach response

**Controller:** [CONTROLLER LEGAL NAME]
**Version:** 2026-09-10
**Owner of this procedure:** [INCIDENT RESPONSE OWNER]

GDPR Art. 33 gives you **72 hours from becoming aware** of a personal data breach to notify the
supervisory authority. Seventy-two hours is not long enough to invent a process. It is barely
long enough to follow one.

Art. 34 separately requires telling the affected individuals where the breach is likely to result
in a high risk to their rights and freedoms — a different test, a different deadline (without
undue delay), and a different audience.

---

## 0. What counts as a breach

Art. 4(12): "a breach of security leading to the accidental or unlawful destruction, loss,
alteration, unauthorised disclosure of, or access to, personal data."

Three things people wrongly exclude:

- **Loss of availability is a breach.** A database deleted with no backup is a breach even though
  nobody saw the data.
- **An internal actor is still unauthorised access** if they had no business need for the data.
- **A misconfiguration counts even with no evidence anyone exploited it.** Public storage buckets
  containing inspection photographs are a breach the moment they are public, not the moment
  someone downloads one. This project has already had exactly that, and it is why this document
  says so.

The clock starts when you have a **reasonable degree of certainty** that a security incident
occurred and personal data was involved. It does not wait for the full picture. A short period
of investigation to establish that certainty is permitted; using investigation as a reason to
delay past it is not.

---

## 1. First hour — contain, do not tidy

1. **Contain.** Revoke the exposed credential, make the bucket private, take the endpoint down.
   Containment beats diagnosis.
2. **Preserve evidence before changing anything you do not have to.** Logs, access records, the
   offending configuration. Fixing first and looking second destroys the record you will need to
   answer "how many people were affected", which is the question you cannot avoid.
3. **Start a written timeline immediately**, with timestamps and who did what. Art. 33(5) requires
   documenting every breach regardless of whether it gets notified, and reconstructing a timeline
   from memory three days later produces a document that helps nobody.
4. **Do not email the affected users yet.** A first message that turns out to be wrong is worse
   than a message an hour later that is right.

## 2. Assess — three questions, in this order

**a. What data, whose, how many?** Categories and approximate numbers of data subjects and of
records. Approximate is acceptable; Art. 33(3) says so. Silence is not.

**b. What is the likely consequence?** Identity theft, fraud, physical safety, professional
reputation, loss of confidentiality. For this product the highest-consequence data is the
combination of a technician's name, their signature image, and the GPS coordinates and timestamp
of where they were working — that is a record of a named individual's movements, and it should
be treated as more sensitive than a list of email addresses.

**c. Is notification required?**

| Question | If yes |
|---|---|
| Is it a personal data breach at all? | Document it (Art. 33(5)) whatever the answer to the rest |
| Is a risk to rights and freedoms unlikely? | Document the reasoning; no authority notification. **This exemption is narrow — encrypted-and-the-key-was-not-taken is the classic case, not "we think it is fine"** |
| Otherwise | Notify the supervisory authority within 72 hours (Art. 33) |
| Is it likely to be a **high** risk to individuals? | Also notify the individuals without undue delay (Art. 34) |

If it is later than 72 hours, notify anyway and state the reason for the delay — Art. 33(1)
requires the reason, and a late notification is far better than a missing one.

## 3. Notify the authority — Art. 33(3) minimum content

1. Nature of the breach; categories and approximate number of data subjects and records
2. Name and contact details of the point of contact for more information
3. Likely consequences
4. Measures taken or proposed, including mitigation

**Where.** The lead supervisory authority is the one in the EU member state of the controller's
main establishment. If the controller is not established in the EU there is no one-stop shop, and
notification goes to the authority in **each** member state where affected individuals live —
through the Art. 27 representative. Fill in [CONTROLLER LEGAL NAME] and
[EU REPRESENTATIVE] before this matters, because working out which authority to call is not a
72-hour task.

Notification may be phased (Art. 33(4)) where the full picture is not available. Send what you
have on time, then supplement.

## 4. Notify the individuals — Art. 34

Required where a **high risk** is likely. Plain language, no hedging, and it must include items
2, 3 and 4 from the list above. Say what happened, what it means for them, and what they should
do now.

Exemptions in Art. 34(3): the data was unintelligible (properly encrypted, key not compromised);
subsequent measures have made the high risk no longer likely; or individual contact would take
disproportionate effort, in which case a public communication is required instead. Reaching for
these exemptions is a decision to document, not a default.

**Where a customer organisation is the controller** — inspection records their technicians
created — they notify their own people. We tell them without undue delay (Art. 33(2)), give them
everything they need, and do not communicate with their staff around them.

## 5. Other regimes that may run at the same time

- **US state laws.** Most require notice to affected residents, several require notice to the
  state attorney general above a threshold, and the deadlines differ from the GDPR's. Check the
  states where affected individuals live.
- **CCPA §1798.150** gives California consumers a private right of action for a breach of certain
  unencrypted personal information resulting from a failure to maintain reasonable security.
- **Contractual obligations to customers** are frequently shorter than the statutory deadline.
  Check the DPA before assuming 72 hours is the binding number.

## 6. Afterwards

- Complete the internal record: facts, effects, remedial action (Art. 33(5)).
- Add a `DEFECT-LOG.md` row naming **which gate should have caught it** and whether that gate now
  exists. A post-mortem that does not change a gate has not finished.
- Update this document if the response revealed a gap in it.

---

## Worked precedent from this project

**Public storage buckets on the retired backend.** Inspection photographs and signature images
were world-readable on the Singapore project that the live site was still compiled against. Found
by auditing the live bundle's compiled Supabase URL against the intended one, not by an alert.

Handled as: contain first (both buckets set private, anonymous fetch verified to return HTTP 400
where it had previously served the image), then export the data for the record, then document.
No notification was made because the project had no real users and no real personal data —
a conclusion reached by checking the row counts, not by assuming.

The lesson that changed a gate: **a bucket is public the moment it is public.** Exposure is the
breach, not the download. And the reason nobody noticed for months was that every gate read the
repository instead of the running system — which is why `test:rls-policies` and
`test:auth-config` now assert the live project.

---

*This procedure states a position and its reasoning. It is not legal advice and has not been
reviewed by counsel.*
