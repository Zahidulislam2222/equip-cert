# Documentation

Public documentation for EquipCert AI. Every document separates what is **measured**, what is
**built**, and what is only **designed for** — and says which is which.

| Document | Answers |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the system is built, the data model, the key flows, and why each major decision was made |
| [SCALING.md](SCALING.md) | What it takes to serve 10k, 100k and 1M concurrent users — the arithmetic, what breaks first, and the cost ladder |
| [AVAILABILITY.md](AVAILABILITY.md) | Uptime targets per tier (99.9 % / 99.95 %), error budgets, failure modes, recovery objectives, runbooks |
| [ROADMAP.md](ROADMAP.md) | The phases from today to 1M+ users, each with measurable exit criteria |
| [SECURITY-MODEL.md](SECURITY-MODEL.md) | Assets, trust boundaries, a STRIDE threat model, the controls, and the known gaps |
| [ACCESSIBILITY.md](ACCESSIBILITY.md) | WCAG 2.1 AA target, what is tested, and what is not yet |
| [compliance/](compliance/README.md) | Which US and EU laws apply and what the codebase does about each |

### Compliance records

| Record | Law |
|---|---|
| [compliance/README.md](compliance/README.md) | Legal map — OSHA, NFPA 10, ESIGN/UETA, eIDAS, GDPR, ePrivacy, US state privacy, AI Act, Cyber Resilience Act, NIS2, ADA, European Accessibility Act |
| [record-of-processing.md](compliance/record-of-processing.md) | GDPR Art. 30 |
| [data-processing-position.md](compliance/data-processing-position.md) | GDPR Art. 28 — controller, processor, DPA contents |
| [sub-processors.md](compliance/sub-processors.md) | GDPR Art. 28(2) |
| [breach-response.md](compliance/breach-response.md) | GDPR Art. 33–34 |
| [ai-act-classification.md](compliance/ai-act-classification.md) | EU AI Act risk classification and Art. 50 |

### Elsewhere in the repository

| Document | Purpose |
|---|---|
| [../README.md](../README.md) | Project overview and getting started |
| [../SECURITY.md](../SECURITY.md) | How to report a vulnerability |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Development workflow and the gates every change passes |
| [../CHANGELOG.md](../CHANGELOG.md) | What changed, and when |
| [../mobile/README.md](../mobile/README.md) | The Flutter Android + iOS client |

None of the legal documents has been reviewed by counsel, and none is legal advice.
