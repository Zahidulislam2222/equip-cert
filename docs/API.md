# API reference

Every server endpoint EquipCert AI exposes, who may call it, what it accepts, and how it fails.

**Reviewed:** 2026-11-25 against `api/`, `deploy/server.ts` and `supabase/migrations/`.

Most data does **not** go through these endpoints. The web and mobile clients read and write
Supabase directly with the user's own session token, and Postgres row-level security decides what
each person may see or change ([ARCHITECTURE.md](ARCHITECTURE.md) D2). The endpoints below exist
only where a server is genuinely needed: a secret key, a third-party call, or a request from
someone who has no account.

The handlers are standalone `@vercel/node` functions. The same files run on Vercel and, unchanged,
behind the self-host adapter `deploy/server.ts`.

---

## 1. Conventions

| Topic | Rule |
|---|---|
| Transport | HTTPS only (HSTS one year). Same security headers on both hosts — [SECURITY-MODEL.md](SECURITY-MODEL.md) §4 |
| Method | Every endpoint is `POST`; anything else returns `405 Method Not Allowed` |
| Authentication | `Authorization: Bearer <Supabase access token>` where marked. Verified server-side on every request; a missing server configuration is an error, never a pass |
| Authorization | Role and organisation are read from the database, never from the request body |
| Input | JSON, validated with a Zod schema; invalid input returns `400` with a short message |
| Errors | `{ "error": "<human-readable message>" }`. Messages never contain stack traces, keys or other users' data |
| Rate limits | Per address before authentication, per account after it. Keys are hashed. Shared across replicas when a store is configured; never fail open. `429` when exceeded |
| Limits and timeouts | Owned by `src/lib/config.ts` — not restated here, so this page cannot drift from the code |

## 2. Endpoints

### `POST /api/analyze` — AI equipment analysis

| | |
|---|---|
| Caller | Signed-in user |
| Body | `image` (base64 of one downscaled photograph) and `mimeType` (JPEG, PNG or WebP); size-capped |
| Does | Sends the image — never the person's identity — to the configured vision provider (Gemini, OpenAI or Anthropic, chosen by configuration) and returns a suggested equipment type, serial number and visible condition |
| Returns | `200` with the suggestion and a server-generated `provenance` block (`aiAssisted`, provider, model, disclosure time) that the signed record stores |
| Fails | `400` invalid input · `401` no or invalid token · `429` rate limited · `500` provider not configured or analysis failed · `503` authentication backend unavailable |
| Note | The model only proposes. The technician confirms or overrides every suggestion and signs ([compliance/ai-act-classification.md](compliance/ai-act-classification.md)) |

### `POST /api/assist` — in-app help assistant

| | |
|---|---|
| Caller | Signed-in member of an organisation |
| Body | A question (length-capped) and a short, bounded history of the current conversation |
| Does | Retrieves the best-matching approved help articles; when the question is about the caller's own organisation, adds a small read-only summary read **with the caller's own token**, so row-level security decides what is visible. Sends that to an allow-listed free model through OpenRouter |
| Returns | `200` with the answer, the help articles it used, whether it was AI-generated and which model answered. If every model fails or times out, `200` with the closest help article instead (`fallback: true`) — never an error page |
| Fails | `400` empty or over-long question · `401` not signed in · `403` not a member of an organisation · `429` per-user or per-address limit · `503` assistant switched off, or authentication backend unavailable |
| Never | Changes data, signs anything, or stores the conversation. Details: [AI-ASSISTANT.md](AI-ASSISTANT.md) |

### `POST /api/dsar` — privacy request intake

| | |
|---|---|
| Caller | Anyone — no account required, because the people most likely to ask for erasure no longer have one |
| Body | Request type, contact details and a description, all supplied by the requester about themselves. No organisation id, status or deadline is accepted |
| Does | Records the request with its statutory deadline (GDPR Art. 12(3); US state equivalents). It does **not** act on it: identity is verified by a person before anything is disclosed or erased |
| Returns | `202 { received: true, duplicate: false }`; an identical repeat returns `duplicate: true` |
| Fails | `400` invalid · `429` rate limited · `500` could not record (the page then gives an email route) · `503` backend unavailable |

### `POST /api/billing/checkout` — start a subscription

| | |
|---|---|
| Caller | Organisation **administrator** (role read from the database) |
| Body | The self-serve plan to buy |
| Does | Creates a Stripe Checkout session priced by lookup key, one seat per active member. It does **not** change the plan |
| Returns | `200 { url }` — the hosted Stripe page |
| Fails | `400` plan not sold online (Enterprise is arranged directly) · `403` not an administrator · `409` already on that plan, or a subscription already exists · `429` · `502` Stripe unreachable · `503` billing not configured |

### `POST /api/billing/portal` — manage billing

| | |
|---|---|
| Caller | Organisation administrator |
| Does | Opens the Stripe customer portal: switch plan, update card, cancel. Seat counts are managed by the server, not the portal |
| Returns | `200 { url }` |
| Fails | `403` · `409` no billing account yet · `429` · `502` · `503` |

### `POST /api/billing/seats` — re-sync the seat count

| | |
|---|---|
| Caller | Any member (called after someone joins or is removed) |
| Does | Counts active members in the database with the service role and applies that number to the subscription. Nothing in the request influences the count, so there is nothing to tamper with |
| Returns | `200 { synced: true, seats }`, or `200 { synced: false, reason }` when there is no subscription or billing is not configured |
| Fails | `401` not signed in · `403` not a member · `429` rate limited · `502` Stripe unreachable |
| Backstop | The webhook re-syncs on every subscription event and before each renewal (`invoice.upcoming`), so a client that never calls this cannot keep seats under-billed past the next invoice |

### `POST /api/webhooks/stripe` — payment events

| | |
|---|---|
| Caller | Stripe only. Verified by the `Stripe-Signature` header over the exact raw bytes received |
| Does | The **only** path that changes an organisation's plan. Re-reads all of the customer's subscriptions and applies the highest paid plan, so a late or duplicate event cannot downgrade a paying customer. Each event id is recorded in `billing_events`, so a repeated delivery is detected and skipped; a concurrent duplicate is harmless because every write sets the current Stripe state |
| Returns | `200` for handled, ignored, duplicate or unmatched events (so Stripe stops retrying) |
| Fails | `400` missing or invalid signature · `500` not configured or internal error (Stripe retries) |

Live payments are switched on when the operator configures live Stripe keys. Until then no card
is charged. The billing handlers refuse a live key unless the operator explicitly allows live keys
(`STRIPE_ALLOW_LIVE_KEYS`), so a configuration mistake cannot start taking real money.

## 3. Database functions

These run inside Postgres with fixed search paths. All except `record_esign_consent` (which runs
with the caller's own rights) are `SECURITY DEFINER` functions, and each one checks the caller
itself; the Supabase security advisor flags this class of function, and the CI gate
accepts the warning for these exact functions only — a new one fails the build.

| Function | Who | What |
|---|---|---|
| `provision_account` | A newly signed-up user with no organisation | Creates their organisation and makes them its administrator. Nobody can attach themselves to an existing organisation |
| `create_invite` | Administrator | Creates a single-use, expiring invitation for a role. Returns the token once; only its hash is stored |
| `accept_invite` | Signed-in user with a valid token | Joins the organisation with the invited role. A database trigger enforces the plan's member limit on every join, however it is attempted |
| `revoke_invite` | Administrator | Revokes an unused invitation |
| `record_esign_consent` | The signing technician | Stores consent to sign electronically, with the consent text version and the server's time. The database refuses a signature without it |
| `erase_subject` | Service role only — an operator action, never callable from a client | GDPR erasure that anonymises the person and keeps the safety finding |

## 4. Operational endpoints (self-host adapter)

| Path | Purpose |
|---|---|
| `GET /healthz` | Liveness: can the process serve at all. Dependency-free by design |
| `GET /readyz` | Readiness: should the load balancer send traffic here. `503 draining` during shutdown |

Behaviour of both, and the drain sequence they drive, is in [AVAILABILITY.md](AVAILABILITY.md) §2.

## 5. Versioning and compatibility

The endpoints are consumed by the two first-party clients only; there is no public third-party API
yet (an integrations API is on the [roadmap](ROADMAP.md)). Changes are made backwards-compatible
with the previous mobile release — new fields are additive and old fields keep their meaning —
because a released app cannot be updated at the same moment as the server.
