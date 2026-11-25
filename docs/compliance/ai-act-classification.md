# EU AI Act — classification memo

**System:** EquipCert AI
**Assessed against:** Regulation (EU) 2024/1689 (Artificial Intelligence Act)
**Date of assessment:** 2026-09-10
**Reviewed:** 2026-11-25 — the in-app help assistant released that day is assessed in §9;
Art. 50 dates re-checked against the Digital Omnibus on AI
**Assessed by:** [CONTROLLER LEGAL NAME]
**Review trigger:** any change to what a model decides, to who acts on its output, or to what the
help assistant can read or do

---

## 1. What the system actually does

EquipCert uses AI in two places. Sections 1 to 8 cover the inspection analysis described here;
§9 covers the help assistant.

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
| General-purpose AI model obligations (Ch. V)? | **No** — we use third-party models; we do not provide a general-purpose AI model |
| Help assistant (§9): high-risk? | **No** — it answers questions about using the product, cannot change data and makes no safety decision |
| Help assistant: subject to Art. 50? | **Yes** — Art. 50(1) disclosure implemented; Art. 50(2) marking partial, see §9 |

Both uses are **limited-risk**. Article 50 transparency applies; the Chapter III high-risk
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
| Art. 50(1) | Disclose to the person that they are interacting with / receiving AI output | **2 Aug 2026, no grace period**; not changed by the Digital Omnibus on AI | **Implemented** |
| Art. 50(2) | Mark generated output in a machine-readable format | 2 Aug 2026; systems already on the market before that date have until **2 Dec 2026** (Digital Omnibus on AI, published 24 Jul 2026, in force 27 Jul 2026) | **Implemented for the inspection PDF — limits in §7** |

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
  being finalised when this was first written, and its final status was not re-checked in the
  2026-11-25 review. The PDF mark is already in place, so the **2 December 2026** date for systems
  on the market before 2 August 2026 is not a blocker; comparing the mark against the code of
  practice is still an open item.
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

The help assistant (§9) sends questions to OpenRouter in the United States, which routes them to
the provider serving the chosen free model. **No transfer basis is established for that yet**;
see [sub-processors.md](sub-processors.md).

## 9. The in-app help assistant (added 2026-11-25)

### 9.1 What it does

A signed-in member of an organisation can open a help panel (web: `HelpAssistant.tsx`; mobile:
`help_screen.dart`) and ask how to use the product. The handler, `api/assist.ts`:

- retrieves the best-matching approved help articles from `src/content/help/knowledge.json`;
- when the question asks about the user's own organisation (overdue equipment, open corrective
  actions, plan usage), adds a short read-only summary: counts, up to five equipment names with
  due dates, the plan and its usage. It reads this **with the user's own session**, so row-level
  security decides what is visible and another organisation's data cannot be read;
- sends the question, a bounded number of earlier turns, the articles and that summary to a model
  through OpenRouter, and returns the answer with the articles it drew on.

Limits that are enforced in code, with values owned by the `assist` block in `src/lib/config.ts`:
only model ids ending in `:free` are called unless paid models are explicitly allowed
(`modelsAllowed` in `src/lib/assist/core.ts`); per-user and per-address hourly rate limits;
bounded question, history and answer lengths; a per-attempt timeout and one attempt per configured
model, with no retries. If the assistant is not configured, no model is allowed, or every model
fails, the user gets the best-matching help article instead, labelled as such and not as AI output.

EquipCert does not store the conversation. The web panel and the mobile screen keep it in memory
until it is closed or restarted; the server logs only failures (model id and HTTP status), never
the question.

### 9.2 Classification

It is a **chatbot built on general-purpose AI models** that interacts with natural persons. We are
the provider of this assistant (we build it and offer it under our name) and a downstream user of
the underlying models; we do not provide a general-purpose AI model, so Chapter V does not apply
to us.

**Not high-risk.** It is not an Annex III use: it does not evaluate workers, allocate work or
manage infrastructure. It is not a safety component under Art. 6(1): it gives no verdict on any
equipment, and its instructions (`src/content/assistant.json`) tell it not to judge whether
equipment is safe or compliant, because that is the qualified inspector's decision. **It cannot
change data**: the handler has no write path and no tools; the instructions tell the model it
cannot sign, edit records, change plans, invite people or contact anyone, and the code gives it no
means to. The worst outcome of a wrong answer is a wrong instruction to the person who asked,
about their own organisation.

### 9.3 Article 50

| | What is implemented | Status |
|---|---|---|
| **Art. 50(1)** — tell people they are interacting with AI | The disclosure text in `src/content/assistant.json` is shown at the top of the panel before the first question can be sent, on the web and in the Flutter app. It says the user is chatting with an AI assistant, what it answers from, that it can make mistakes and cannot change anything, that questions go through OpenRouter to free models whose providers may retain them, and that EquipCert does not store the conversation. On the web the panel header also carries an "AI" badge. `mobile/test/assist_copy_contract_test.dart` keeps the mobile wording identical to the web; `e2e/browser/flows.spec.mjs` checks the disclosure in a real browser | Implemented |
| **Art. 50(2)** — machine-readable marking of generated text | The assistant went live after 2 August 2026, so no grace period applies. Each answer is labelled as AI output on screen ("AI-generated — check important answers." on the web, "AI assistant" in the mobile app), and the API response marks it `aiGenerated: true` with the model id and prompt version; a help-article fallback is marked `aiGenerated: false`. The answer text itself carries no embedded or watermark-style mark, and nothing marks it once a user copies it out of the panel | Partial — whether the response flag is a sufficient machine-readable mark for text shown inside the product is an open question for counsel and the Commission's code of practice |

### 9.4 Known gaps

- **No processing agreement with OpenRouter yet**, and no verified retention or transfer terms.
  Free-model endpoints may be served by providers that log or train on prompts; the disclosure
  tells users this and asks them not to type personal or confidential details. Signing a DPA (or
  replacing the provider) and restricting routing to providers that do not retain prompts is an
  owner action and a release blocker before real customer data.
- **Equipment names are customer-entered text** and reach the model inside the account summary.
  The instructions treat that text as data, not instructions, and the model has nothing it could
  act on, so an injected instruction can at most distort an answer to a member of the same
  organisation.
- **Free models change.** A configured free model can be withdrawn or rate-limited upstream; the
  assistant then falls back to help articles. Answer quality is not guaranteed and is not claimed.
- **Art. 50(2)** as described in §9.3.

---

*This memo states a position and its reasoning. It is not legal advice, and it has not been
reviewed by counsel. [CONTROLLER LEGAL NAME] should have it reviewed before relying on it in a
regulatory context.*
