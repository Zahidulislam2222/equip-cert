# EU AI Act — classification memo

**System:** EquipCert AI
**Assessed against:** Regulation (EU) 2024/1689 (Artificial Intelligence Act)
**Date of assessment:** 2026-09-10
**Assessed by:** [CONTROLLER LEGAL NAME]
**Review trigger:** any change to what the model decides, or to who acts on its output

---

## 1. What the system actually does

A qualified technician photographs a piece of safety equipment. The photo is sent to a
third-party vision model, which returns a suggested equipment name, a suggested serial number,
a suggested safety status, and a list of possible issues. Those suggestions **pre-fill a
checklist**. The technician then works through that checklist item by item, marks each one pass
or fail, and signs.

The signature is the operative act. The record that is stored, and that an inspector or
insurer would later rely on, is **the technician's checklist**, not the model's output.

## 2. Conclusion

| Question | Answer |
|---|---|
| Prohibited practice (Art. 5)? | **No** |
| High-risk under Annex III? | **No** — reasoning in §3 |
| High-risk as a safety component under Art. 6(1)? | **No** — reasoning in §4 |
| Subject to Art. 50 transparency? | **Yes** — implemented, see §5 |
| General-purpose AI model obligations (Ch. V)? | **No** — we are a deployer of a third-party model, not its provider |

The system is **limited-risk**. Article 50 transparency applies; the Chapter III high-risk
regime does not.

## 3. Why not Annex III

Annex III lists eight high-risk areas. Two are worth arguing rather than dismissing, because a
careless reading puts this system in both.

**Annex III(2) — critical infrastructure.** This covers AI used as a *safety component in the
management and operation* of critical digital infrastructure, road traffic, or the supply of
water, gas, heating and electricity. Fire extinguishers and workplace safety equipment are
safety equipment, but the system is not a safety component *of critical infrastructure*, and it
does not manage or operate anything. It suggests text on a form. If the model returns nonsense,
nothing actuates, nothing fails open, and no supply is interrupted — a human reads the
suggestion and corrects it.

**Annex III(3) / III(4) — education and employment.** The output describes *equipment*, not
people. It is not used to evaluate the technician, allocate work, or inform any decision about
a worker's employment. `inspector_name` records who performed the inspection because NFPA 10
and OSHA 29 CFR 1910.157 require a named qualified person; it is never an input to the model
and never scored.

**The decisive factor in both cases is that a qualified human makes the determination**, has the
information needed to overrule the model, and attests to the result under their own name. The
AI's role is to save typing.

## 4. Why not a safety component under Art. 6(1)

Art. 6(1) catches AI intended to be used as a safety component of a product covered by the
Annex I harmonisation legislation, where that product must undergo third-party conformity
assessment. EquipCert is not embedded in any product. It is a record-keeping application used
*alongside* equipment that is itself separately certified. Removing EquipCert entirely does not
make any extinguisher less safe; it makes the paperwork slower.

## 5. Article 50 — what applies and what we do

Two obligations with two deadlines, routinely conflated:

| | Obligation | Applies from | Status |
|---|---|---|---|
| Art. 50(1) | Disclose to the person that they are interacting with / receiving AI output | **2 Aug 2026, no grace period** | **Implemented** |
| Art. 50(2) | Mark generated output in a machine-readable format | 2 Aug 2026, with pre-existing systems given until **2 Dec 2026** (AI Omnibus, May 2026) | **Implemented for the inspection PDF — limits in §7** |

**Art. 50(1) as implemented.** When any part of an inspection is AI-derived, the technician sees
a disclosure panel *before* the checklist they are about to sign. It is not dismissible and it
does not depend on an animation completing. It names the specific provider and model that
produced the result, and states plainly that the technician is the inspector of record and that
their signature attests to the corrected result rather than to the suggestion.

**Provenance.** Every inspection record carries `ai_assisted`, `ai_provider`, `ai_model` and
`ai_disclosed_at`. These are stamped **server-side**, because only the server knows which model
ran. A database constraint (`ai_provenance_is_complete`) rejects a partially-filled set, so a
record cannot claim AI assistance without naming the system, or name a system without admitting
assistance.

**Art. 50(2) as implemented.** The inspection report PDF is the copy of the output that leaves
the system, so it carries the mark. `src/lib/pdf-provenance.ts` builds it from the provenance
columns above; `InspectionReportPDF.tsx` only renders what it returns.

- **Machine-readable:** the PDF Info dictionary. `/Keywords` holds `key=value` pairs —
  `ai-assisted`, `ai-provider`, `ai-model`, `ai-disclosed-at`, `record-id`,
  `disclosure=eu-ai-act-art-50` — and the same pairs are repeated at the end of `/Subject`.
  A human-only record is marked `ai-assisted=false` and never names a provider.
- **Human-readable:** a visible disclosure line on the report naming the provider and model.
- **Proof:** `unit/pdf-provenance.test.mjs` renders a real PDF with the production library and
  reads `/Keywords` and `/Subject` back out of the bytes.

That test caught a real defect before it shipped: `@react-pdf/renderer` 4.3.2 declares a
`keywords` prop in its types but reads `keyboards` (a typo) when writing `/Keywords`, so the
first implementation produced PDFs with no Keywords entry at all while every props-level test
passed. Both names are now passed, and the pairs are duplicated into `/Subject` so the mark does
not depend on that one field.

## 6. Human oversight, recorded honestly

There is no automated decision-making within the meaning of GDPR Art. 22 here. The model never
determines the outcome; it proposes a starting point. The technician:

- sees every suggested item individually and must actively mark each pass or fail,
- can change the equipment name and any checklist item,
- signs, and the signature is what makes the record immutable.

## 7. Known gaps

The Art. 50(2) marking in §5 is real but deliberately described at its actual strength:

- **Metadata, not a watermark.** Info-dictionary entries survive copying and emailing, but anyone
  who re-saves or prints the PDF can strip them. There is no C2PA manifest and no cryptographic
  signature binding the mark to the content. The Commission's Art. 50 code of practice was still
  being finalised when this was written; this memo is to be revisited against it before the
  **2 December 2026** deadline for this system.
- **XMP is not written.** The renderer does not emit an XMP metadata stream, so tools that read
  only XMP will not see the mark.
- **The PDF is the only marked export.** Screen views carry the Art. 50(1) disclosure, not a
  machine-readable mark; if a CSV or API export of inspection data is added, it needs its own.

Recorded here rather than omitted, because an incomplete compliance record is worse than an
honest one.

## 8. Third-country transfer

The vision model providers are established in the **United States**. Inspection photographs are
transferred there for analysis. This is documented in the record of processing and the
sub-processor list, and disclosed in the privacy policy. The primary datastore is in the EU
(Frankfurt), so the transfer is limited to the photograph submitted for analysis and is not the
resting place of the record.

---

*This memo states a position and its reasoning. It is not legal advice, and it has not been
reviewed by counsel. [CONTROLLER LEGAL NAME] should have it reviewed before relying on it in a
regulatory context.*
