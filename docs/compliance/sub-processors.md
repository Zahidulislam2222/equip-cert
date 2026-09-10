# Sub-processors

**Controller:** [CONTROLLER LEGAL NAME]
**Version:** 2026-09-10
**Review trigger:** before any new third party receives personal data, and at least annually

GDPR Art. 28(2) requires the controller's prior authorisation before a processor engages a
sub-processor, and Art. 28(4) makes the processor liable for its sub-processors' failures. This
list is what "prior authorisation" is given against. It is also the answer to the question every
serious customer's security review asks first.

The list is deliberately short. Every entry is a party that could technically see personal data,
including ones that only see it in transit — a party you did not disclose because "they only
route packets" is a party you did not disclose.

---

## Current sub-processors

| Sub-processor | What they do | Personal data they can reach | Location of processing | Transfer basis |
|---|---|---|---|---|
| **Supabase** (Supabase Inc., infrastructure on AWS) | Database, authentication, file storage, realtime | All account and inspection data, evidence photographs, signatures | **EU — Frankfurt (eu-central-1)** | None required — data stays in the EEA |
| **Google** (Gemini API) | Vision analysis of an equipment photograph | The photograph submitted for analysis only | United States | SCCs; EU–US Data Privacy Framework where certified |
| **Contentful** | Equipment checklist templates | **None.** Templates only; no personal data is sent | EU | n/a |
| **Cloudflare** | DNS, TLS termination, CDN in front of the origin | IP addresses and request metadata in transit | Global edge | SCCs |
| **Contabo** (shared VPS) | Hosting the origin server | Data in transit through the application process | Germany | None required |
| **Vercel** | Alternative hosting target for the same build | Same as above, when that target is used | United States / global edge | SCCs; DPF where certified |
| **Stripe** | Subscription payments | Billing contact and payment metadata. **Card numbers never reach our systems** | United States / EU | SCCs; DPF |

**Stripe is not currently configured.** No payment data is processed today. It is listed because
the integration exists in the codebase and would activate on configuration — disclosing it only
after switching it on would be disclosing it too late.

**The AI provider is configurable.** `AI_PROVIDER` selects Google, OpenAI or Anthropic. Google is
the configured default. Changing it changes who receives inspection photographs, so it is a
sub-processor change and requires this document and the privacy policy to be updated first, not
afterwards.

---

## What is deliberately not on this list

**No analytics provider. No advertising network. No session-recording or heat-mapping tool. No
error-tracking service. No customer-messaging widget. No CDN-hosted font or script.**

That last one is not padding. A Google Fonts stylesheet reached from the browser sends every
visitor's IP address to a third country on page load; a German court has held that doing so
without consent infringes the GDPR. Fonts here are self-hosted, and the Content Security Policy
enumerates every origin the application may contact — so this list can be checked against the
CSP in `vercel.json` rather than believed.

---

## Onboarding a new sub-processor

1. Confirm a GDPR Art. 28(3) data processing agreement is in place **before** any data flows.
2. Establish the transfer basis if processing happens outside the EEA, and record it here.
3. Add it to this file, to the record of processing, and to the privacy policy — bump the
   privacy policy's `documentVersion`, which invalidates consent given against the old version.
4. Add its origin to `connect-src` in `vercel.json` and regenerate the deploy artifacts. If it
   is not in the CSP the browser cannot reach it, which is the intended failure direction.
5. Give existing customers notice before the change takes effect, per Art. 28(2).

---

*This document states a position and its reasoning. It is not legal advice and has not been
reviewed by counsel.*
