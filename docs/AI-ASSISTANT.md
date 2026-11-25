# AI in EquipCert

EquipCert uses AI in two places. Both are built so that a person, not a model, stays responsible
for every safety record.

**Reviewed:** 2026-11-25 against `api/analyze.ts`, `api/assist.ts`, `src/lib/assist/core.ts`,
`src/content/assistant.json`, `src/content/help/knowledge.json` and the Flutter client.

| | Equipment analysis | Help assistant |
|---|---|---|
| Where | Inspection flow, web and mobile | Help screen, web and mobile |
| Endpoint | `POST /api/analyze` | `POST /api/assist` |
| What it does | Suggests equipment type, serial number and visible condition from a photograph | Answers "how do I…" and "what does this mean…" questions about the product and the user's own organisation |
| Provider | Gemini, OpenAI or Anthropic — one configuration value | Free models routed through OpenRouter, from an allow-list |
| Can it change data? | No. It returns a suggestion the technician confirms or overrides | No. It has no write access and no tools that act |
| Legal position | [AI Act memo](compliance/ai-act-classification.md) | Same memo; disclosure under EU AI Act Art. 50(1) |

---

## 1. Equipment analysis

The technician photographs the equipment; the photograph (never the person's identity) goes to the
configured vision provider; the answer comes back marked as AI-derived. The technician works
through the checklist, sees which parts were AI-assisted, and signs. The server stamps the
provider, model and disclosure time on the record, and the PDF report carries the same marking in
machine-readable metadata (EU AI Act Art. 50(2)).

If the provider is down or out of quota, the technician completes the checklist by hand. The model
only ever proposed, so nothing is lost.

## 2. Help assistant

### 2.1 Who it serves and what it is for

| User | Typical question |
|---|---|
| Technician | "What happens to my inspection if I have no signal?" · "Can I edit an inspection after signing it?" |
| Manager | "Which equipment is overdue?" · "How do I export inspections?" |
| Administrator | "How do I invite a new technician?" · "Where do I cancel our subscription?" |

### 2.2 What it will not do

It cannot sign, edit records, change plans, invite people or contact anyone — it explains where in
the app the user can do it. It gives **no engineering or legal judgement** about whether specific
equipment is safe or compliant — that is the qualified inspector's decision — and it never invents
features, prices, deadlines or legal advice: if the articles and account data do not hold the
answer, it says so. These rules are in its versioned instructions (`src/content/assistant.json`),
and the evaluation (§2.6) tests them.

### 2.3 Where its answers come from

1. **Approved help articles** — 18 articles in `src/content/help/knowledge.json`, one file with an
   owner, versioned with the code. The best-matching articles are retrieved for each question.
2. **The user's own organisation** — only when the question needs it, a small read-only summary
   (counts, equipment names, due dates) is read **with the user's own session token**. Row-level
   security therefore decides what is visible, exactly as in the app: the assistant cannot see
   another organisation's data because the user cannot.

Retrieved text is treated as data, not instructions. An equipment item named "ignore your rules"
is just a name.

### 2.4 Transparency and privacy

- **Disclosed as AI before the first question**, on web and mobile, with what it can and cannot do.
- **No conversation storage.** EquipCert keeps no transcript. The question is sent through
  OpenRouter to a free model, and the providers that serve free models may log or retain what they
  receive under their own terms, so the disclosure asks users not to type personal or confidential
  details. The privacy policy says the same.
- **A human path:** every answer offers the organisation's administrator, and the privacy request
  page for personal-data questions.
- **Before real customer data flows through it,** the operator must use a dedicated, spending-capped
  key and have a data processing agreement in place for the routing service. Until then the
  [sub-processor list](compliance/sub-processors.md) records its transfer basis as not yet
  established.

### 2.5 Cost, limits and failure behaviour

All values below are configuration in `src/lib/config.ts` (the `assist` block), not code.

| Control | Behaviour |
|---|---|
| Model allow-list | Only models whose id ends in `:free` are called; allowing a paid model is a separate, explicit setting |
| Rate limits | Per user (30 questions an hour by default) and per address |
| Bounded input and output | Question length, history turns, answer length and output tokens are capped |
| Timeouts | Each model attempt has a deadline; at most one attempt per configured model — no retry storms |
| Outage | If no model answers while the assistant is on, the user gets the closest help article instead of an error |
| Off switch | `ASSIST_ENABLED=false` turns it off; the panel says it is switched off and keeps the human route (the administrator, the privacy request page). The help articles are not reachable while it is off |

### 2.6 How it is evaluated

| Suite | What it checks | Result (2026-11-25) |
|---|---|---|
| `unit/assist.test.mjs` | Retrieval, guards, limits, free-model allow-list, fallback, output handling — offline | 13 tests, passing |
| `node scripts/eval-assistant.mjs` | Live behaviour against the configured free models: 7 answer cases, 3 prompt-injection cases (including an injection hidden in the organisation's own data), 1 unknown-answer case, 1 safety-judgement case | **12/12** |

Pass thresholds: answer cases ≥ 80 %; injection, unknown and safety cases 100 %. A case where no
model answered is reported as unavailable, not as a pass. The evaluation refuses to run if any
configured model is not free.

The evaluation is re-run whenever the prompt, model list, retrieval or help content changes.
