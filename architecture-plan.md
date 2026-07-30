# Local Multi-Provider LLM Router — Architecture & Development Plan

**Project type:** Self-hosted Next.js application
**Primary consumer:** GitHub Copilot (VS Code), and any OpenAI-compatible client
**Purpose:** Pool multiple free-tier API keys across multiple LLM providers behind a single local, OpenAI-compatible gateway, with intelligent failover, penalty/suspension handling, and a management GUI.

---

## Table of Contents

1. Goals & Non-Goals
2. Core Concepts & Terminology
3. Tech Stack
4. High-Level Architecture
5. Request Lifecycle
6. Data Model
7. Provider Adapter Layer (Format Translation)
8. Authentication & Gateway Endpoint Design
9. Pool Engine & Load Balancing
10. Health, Penalty & Suspension System
11. GUI / UX Design
12. Logging & Observability
13. Security Considerations
14. Configuration Reference (Defaults)
15. Design Decisions & Assumptions
16. Development Phases (for AI agent execution)
17. Glossary

---

## 1. Goals & Non-Goals

### Goals
- Provide **one local, OpenAI-compatible endpoint** that GitHub Copilot (or any other tool) can be pointed at using a single "unified API key," regardless of how many real provider accounts sit behind it.
- Allow the user to register any number of **providers**, each with its own base URL, native API format, and one or more **API keys**.
- Allow keys to be grouped into **pools** that transparently fail over between accounts/providers when one is rate-limited, out of quota, or erroring.
- Never bubble up an upstream error to the client **unless every eligible key in the pool has been exhausted**.
- Track key health with a **penalty/suspension system** that distinguishes recoverable errors (rate limits, transient server errors) from terminal ones (quota exhaustion), with escalating cooldowns for repeat offenders.
- Provide a full GUI (no manual DB editing) to manage providers, keys, models, and pools, and to inspect live health and request history.

### Non-Goals (for the initial build described here)
- This is **not** a public-facing multi-tenant SaaS — it is a single-user, localhost-first tool. Multi-user auth is out of scope.
- This is not a billing/cost-tracking system. Quota usage is inferred only from error responses, not from precise token-cost accounting (a token/usage counter is included as a best-effort metric, not a source of truth).
- This does not attempt to normalize *every* possible provider quirk — it targets the three broad request/response shapes described below (chat-completions, messages, responses). Providers that don't fit one of these three shapes are out of scope until a new adapter is added.

---

## 2. Core Concepts & Terminology

| Term | Meaning |
|---|---|
| **Provider** | A registered upstream LLM service (e.g., "Mimo Account Group", "Gemini", "OpenRouter-compatible endpoint"). Defined by a base URL and a native API format. |
| **API Key** | A single credential belonging to a Provider. A Provider can have many API Keys (e.g., 5 separate free Mimo accounts registered as 5 keys under one "Mimo" provider). |
| **Provider Model** | A model identifier exposed by a Provider (e.g., `gemini-1.5-pro`), paired with a human-readable display name and optional capability tags (vision, function-calling, etc.). |
| **Pool** | A named, routable group of one or more (Provider + Model) targets. Each Pool exposes a **Virtual Model Name** that clients call. Internally, a pool round-robins/falls-over across every enabled API Key belonging to its member targets. |
| **Virtual Model Name** | The string a client (e.g., Copilot) puts in the `model` field of its request to reach a specific Pool. |
| **Simple Pool** | A Pool with exactly one member (one Provider + one Model), rotating across that provider's keys only. This is the "API key pool" from requirement 05. |
| **Unified Pool** | A Pool with multiple members spanning different providers and/or models. This is the "advanced pool" from requirement 06. Architecturally identical to a Simple Pool — see §15. |
| **Healthy / Active** | A key that is eligible for normal, first-choice routing. |
| **Penalized** | A key temporarily removed from first-choice routing after a recoverable error, with an escalating cooldown timer. Auto-recovers when the timer expires. |
| **Suspended** | A key removed from routing after a terminal error (quota exhausted). Does **not** auto-recover — only a manual action in the GUI reactivates it. |
| **Disabled** | A key manually turned off by the user, independent of the health system. |
| **Unified Gateway Key** | The single local API key that external tools (Copilot, curl, etc.) use to authenticate against this application. |
| **Canonical Request/Response** | The internal, provider-agnostic representation of a chat request/response that the routing engine and pool logic operate on, before/after translation to/from a specific provider's wire format. |

---

## 3. Tech Stack

- **Framework:** Next.js (App Router), TypeScript, deployed as a single local server (GUI + API + gateway all in one process).
- **ORM / DB:** Prisma ORM with a SQLite file database (single-file, zero external dependency — appropriate for a local tool).
- **UI components:** shadCN UI.
- **Icons:** lucide-react.
- **Styling:** Tailwind CSS (required by shadCN).

---

## 4. High-Level Architecture

```
                            ┌───────────────────────────────────────────┐
                            │                Client Side                 │
                            │   VS Code + GitHub Copilot (or curl, etc.) │
                            └────────────────────┬────────────────────────┘
                                                 │ HTTP(S) to localhost
                                                 │ Header: Authorization: Bearer <unified key>
                                                 │ Body: OpenAI chat-completions shape
                                                 ▼
        ┌────────────────────────────────────────────────────────────────────┐
        │                    LOCAL ROUTER APPLICATION (Next.js)                │
        │                                                                      │
        │   ┌────────────────┐        ┌──────────────────────────────────┐    │
        │   │   Admin GUI     │        │        Public Gateway API         │    │
        │   │  (shadCN UI)    │        │  POST /api/gateway/v1/chat/       │    │
        │   │  Dashboard,     │        │       completions                  │    │
        │   │  Providers,     │        └────────────────┬───────────────────┘    │
        │   │  Pools, Logs,   │                         │                        │
        │   │  Settings       │                         ▼                        │
        │   └────────┬────────┘        ┌──────────────────────────────────┐    │
        │            │                  │     Gateway Auth Middleware       │    │
        │            │                  │  (validates unified key hash)     │    │
        │            │                  └────────────────┬───────────────────┘    │
        │            │                                   ▼                        │
        │            │                  ┌──────────────────────────────────┐    │
        │            │                  │     Model Resolver                 │    │
        │            │                  │  virtualModelName → Pool           │    │
        │            │                  │  OR "provider/model" → direct mode │    │
        │            │                  └────────────────┬───────────────────┘    │
        │            │                                   ▼                        │
        │            │                  ┌──────────────────────────────────┐    │
        │            │                  │     Failover Orchestrator          │    │
        │            │                  │  builds Tier-1 / Tier-2 candidate  │    │
        │            │                  │  list, iterates until success      │    │
        │            │                  └───┬──────────────┬───────────────┘    │
        │            │                      │              │                    │
        │            │                      ▼              ▼                    │
        │            │            ┌───────────────┐  ┌──────────────────┐        │
        │            │            │  Provider      │  │  Health & Penalty │        │
        │            │            │  Adapters       │  │  Tracker          │        │
        │            │            │ (format xlat)   │  │ (state machine)   │        │
        │            │            └───────┬────────┘  └─────────┬─────────┘        │
        │            │                    │                     │                  │
        │            │                    ▼                     ▼                  │
        │            │            (calls upstream)      updates key status         │
        │            │                                                              │
        │            └───────────────────────────────┬──────────────────────────────┘
        │                                             ▼
        │                          ┌──────────────────────────────────┐
        │                          │   Request / Usage Logs            │
        │                          └──────────────────────────────────┘
        │                                             │
        │                                             ▼
        │                          ┌──────────────────────────────────┐
        │                          │      Prisma ORM  →  SQLite DB      │
        │                          └──────────────────────────────────┘
        └────────────────────────────────────┬──────────────────────────────────────┘
                                             │ HTTPS (outbound)
                    ┌────────────────────────┼─────────────────────────┐
                    ▼                        ▼                          ▼
             ┌─────────────┐         ┌──────────────┐          ┌────────────────┐
             │ Provider A   │         │ Provider B    │          │  Provider C     │
             │ (chat-       │         │ (messages,    │          │ (responses,     │
             │ completions  │         │ e.g. Claude-  │          │  e.g. newer     │
             │ format, e.g. │         │ style)        │          │  OpenAI-style   │
             │ OpenAI-like) │         │               │          │  APIs)          │
             └─────────────┘         └──────────────┘          └────────────────┘
```

---

## 5. Request Lifecycle

Numbered step-by-step trace of one incoming chat request from Copilot:

```
 1. Copilot sends POST /api/gateway/v1/chat/completions
      Headers: Authorization: Bearer <unified key>
      Body:    { model: "<virtual-model-name>", messages: [...], stream: true|false, ... }

 2. Gateway Auth Middleware validates the bearer token against the stored
    hash of the unified key. Reject with 401 if invalid.

 3. Request body is parsed into the Canonical Request shape
    (model, messages, system prompt, temperature, max_tokens, stream flag,
    tool/function definitions if present).

 4. Model Resolver looks at the "model" field:
      a. If it matches a Pool's Virtual Model Name → resolve to that Pool.
      b. Else if it matches the direct-addressing syntax "providerName/modelId"
         → resolve to a single-member, on-the-fly "pool" over just that
         provider's currently enabled keys (used for testing one provider
         without building a full Pool).
      c. Else → 400 error, unknown model.

 5. Failover Orchestrator builds an ordered candidate list of
    (ApiKey, ProviderModel) pairs from the resolved Pool's member(s):
      Tier 1: all ACTIVE/healthy keys, ordered by the pool's routing strategy.
      Tier 2: all PENALIZED keys (cooldown not yet expired), ordered by
              soonest-expiring cooldown — used only if Tier 1 is empty or
              every Tier 1 attempt fails.
      (SUSPENDED and DISABLED keys are never included.)

 6. Orchestrator attempts candidates in order:
      a. Pick next candidate.
      b. Provider Adapter for that provider's message-type translates the
         Canonical Request into the provider's native wire format and
         calls the provider's base URL with that key's secret.
      c. On success: adapter translates the provider's native response
         back into the Canonical Response, which is then serialized into
         an OpenAI chat-completions-shaped response (and, if streaming,
         chat-completions-style SSE delta chunks) and returned to Copilot.
         The key's health counters are reset (consecutive failures = 0,
         lastUsedAt updated). Loop ends.
      d. On failure: the Error Classifier inspects the HTTP status and
         response body to assign a classification (quota_exceeded,
         rate_limited, server_error, network_error, auth_error,
         invalid_request, unknown). The Health & Penalty Tracker updates
         that key's state accordingly (see §10). The failure is logged.
         Loop continues to the next candidate.

 7. If every candidate in Tier 1 and Tier 2 has failed (or the list was
    empty to begin with), the Orchestrator returns a single aggregated
    error to the client, listing which candidates were tried and why each
    failed, so the failure is diagnosable from the client side too.

 8. Every attempt (success or failure) is written to the Request Log with
    latency, classification, and which key/provider ultimately served (or
    failed to serve) the request.
```

---

## 6. Data Model

All entities below are described logically; final field names are an implementation detail for the Prisma schema, but the structure and relationships should match this exactly.

### 6.1 Entity-Relationship Overview

```
 ┌───────────┐        1        ┌───────────────┐        1        ┌───────────┐
 │  Provider  │───────────────▶│   ApiKey       │◀───────────────│  (health &  │
 │            │        *        │  (per account) │        *        │  penalty     │
 └─────┬─────┘                 └───────┬────────┘                 │  fields live │
       │ 1                              │ *                        │  ON ApiKey)  │
       │                                 ▼                          └─────────────┘
       │ *                     ┌──────────────────┐
       ▼                       │  RequestLog       │
 ┌───────────────┐             │  (references      │
 │ ProviderModel  │◀───────┐   │  ApiKey + Pool)   │
 └───────┬───────┘         │   └──────────────────┘
         │ *               │ *
         ▼                 │
 ┌───────────────┐   ┌─────┴─────┐        *        ┌───────────┐
 │  PoolMember    │──▶│    Pool    │◀────────────────│ (virtual   │
 │ (Pool + Model  │ * │            │                  │  model name│
 │  join row)     │   └───────────┘                  │  is unique │
 └───────────────┘                                    │  on Pool)  │
                                                        └───────────┘

 ┌────────────────────┐
 │   AppSettings        │  (singleton row: unified gateway key hash,
 │                       │   penalty engine defaults, misc config)
 └────────────────────┘
```

### 6.2 `Provider`
| Field | Type | Notes |
|---|---|---|
| id | identifier | primary key |
| name | string | user-facing label, e.g. "Mimo", "Gemini Free Tier" |
| baseUrl | string | root API URL for this provider |
| apiFormat | enum: `CHAT_COMPLETIONS`, `MESSAGES`, `RESPONSES` | which native wire format this provider speaks — determines which adapter is used |
| notes | string, optional | free-text notes |
| createdAt / updatedAt | datetime | |

### 6.3 `ApiKey`
| Field | Type | Notes |
|---|---|---|
| id | identifier | primary key |
| providerId | FK → Provider | |
| label | string | user-facing nickname, e.g. "Account 3" |
| secretEncrypted | string | the real API key, encrypted at rest |
| status | enum: `ACTIVE`, `DISABLED`, `PENALIZED`, `SUSPENDED` | current routing eligibility |
| manuallyDisabled | boolean | user toggle, independent of health engine |
| penaltyLevel | integer, default 0 | escalation counter, see §10 |
| penaltyExpiresAt | datetime, nullable | when the current penalty cooldown ends |
| lastPenaltyEndedAt | datetime, nullable | used to compute the escalation reset window |
| suspendedReason | string, nullable | e.g. "quota_exceeded" |
| consecutiveFailures | integer, default 0 | reset to 0 on any success |
| lastUsedAt | datetime, nullable | for least-recently-used ordering |
| createdAt / updatedAt | datetime | |

### 6.4 `ProviderModel`
| Field | Type | Notes |
|---|---|---|
| id | identifier | primary key |
| providerId | FK → Provider | |
| modelId | string | the identifier the provider's API expects, e.g. `gemini-1.5-pro` |
| displayName | string | human-readable label shown in the GUI |
| supportsVision | boolean | capability tag used to build capability-specific pools |
| supportsFunctionCalling | boolean | capability tag |
| contextWindow | integer, optional | informational only |
| enabled | boolean | quick on/off without deleting |
| createdAt / updatedAt | datetime | |

### 6.5 `Pool`
| Field | Type | Notes |
|---|---|---|
| id | identifier | primary key |
| name | string | user-facing label |
| virtualModelName | string, unique | the value clients put in `model` to hit this pool |
| description | string, optional | |
| routingStrategy | enum: `ROUND_ROBIN`, `PRIORITY` | how Tier-1 candidates are ordered across members/keys |
| createdAt / updatedAt | datetime | |

*(There is intentionally no `poolType` field distinguishing "Simple" vs "Unified" at the data layer — see §15 for why.)*

### 6.6 `PoolMember`
| Field | Type | Notes |
|---|---|---|
| id | identifier | primary key |
| poolId | FK → Pool | |
| providerModelId | FK → ProviderModel | |
| priority | integer | used when `routingStrategy = PRIORITY`; lower = tried first |

### 6.7 `RequestLog`
| Field | Type | Notes |
|---|---|---|
| id | identifier | primary key |
| poolId | FK → Pool, nullable | null for direct-mode requests |
| apiKeyId | FK → ApiKey, nullable | which key ultimately handled (or last attempted) the request |
| providerModelId | FK → ProviderModel, nullable | |
| tier | enum: `TIER_1`, `TIER_2` | which retry tier this attempt came from |
| outcome | enum: `SUCCESS`, `FAILURE` | |
| errorClassification | enum, nullable | see §10.1 |
| httpStatus | integer, nullable | |
| latencyMs | integer | |
| promptTokens / completionTokens | integer, nullable | best-effort, if provider reports them |
| requestedVirtualModel | string | what the client asked for, for auditing |
| createdAt | datetime | |

### 6.8 `AppSettings` (singleton row)
| Field | Type | Notes |
|---|---|---|
| id | fixed value (singleton) | |
| unifiedGatewayKeyHash | string | hash of the local gateway key clients authenticate with |
| unifiedGatewayKeyPrefix | string | last-4/display fragment, for the GUI to show without revealing the full key |
| penaltyBaseCooldownSeconds | integer | default 600 (10 min) — see §14 |
| penaltyMultiplier | float | default 3 |
| penaltyMaxCooldownSeconds | integer | default 21600 (6 h) cap |
| penaltyResetWindowSeconds | integer | default 3600 (1 h) of sustained health before escalation resets |

---

## 7. Provider Adapter Layer (Format Translation)

The router must speak three different upstream "dialects," while always presenting one consistent dialect (OpenAI chat-completions) to Copilot. This is handled with a canonical intermediate shape and one adapter per dialect.

### 7.1 The Canonical Request/Response shape
An internal, provider-agnostic representation carrying: target model id, ordered list of messages (role + content, where content may include text and/or image blocks for vision models), an optional system prompt, generation parameters (temperature, max tokens, etc.), a streaming flag, and optional tool/function definitions. All routing, pooling, and health logic operates purely on this canonical shape and never needs to know which of the three dialects is in play.

### 7.2 The three supported dialects
| Dialect | Typical shape | Example real-world providers |
|---|---|---|
| `CHAT_COMPLETIONS` | `messages[]` array with role/content; response has `choices[].message`; streaming uses `delta` chunks | OpenAI-compatible endpoints (most free-tier proxies, many open-source-model hosts) |
| `MESSAGES` | Separate top-level `system` field; `content` is an array of typed blocks; response has a `content` array and a `stop_reason`; streaming uses typed SSE events | Anthropic-style APIs |
| `RESPONSES` | `input` array and structured `output` items; a newer, more structured request/response envelope | Newer OpenAI "responses"-style APIs |

### 7.3 Adapter responsibilities
Each adapter (one per dialect) is responsible for exactly four conversions:
1. **Outbound request build:** Canonical Request → that dialect's native JSON body + required headers/auth placement for that specific provider.
2. **Inbound response parse (non-streaming):** native JSON response → Canonical Response.
3. **Inbound stream chunk parse:** native SSE event/chunk → a canonical incremental delta.
4. **Error body parse:** native error JSON/status → a normalized `(httpStatus, providerErrorMessage, providerErrorCode)` tuple that is handed to the Error Classifier (§10.1).

### 7.4 Outbound serialization to the client
Regardless of which dialect answered upstream, the Canonical Response (or canonical stream deltas) is always serialized back out to the client in **OpenAI chat-completions** shape — both for normal responses and SSE streaming — because that is the format GitHub Copilot's custom-endpoint configuration expects (requirement 04). The architecture keeps this serialization step separate from the adapters themselves so that, in the future, the gateway could also expose a `/v1/messages`-shaped endpoint for a different client without touching any adapter code.

---

## 8. Authentication & Gateway Endpoint Design

- On first run, the application generates a **Unified Gateway Key** (a long random secret), stores only its hash, and displays the plaintext once in the Settings page ("copy it now — this is the key you paste into Copilot's endpoint configuration"). It can be regenerated on demand (invalidating the old one).
- The public endpoint (e.g. `POST /api/gateway/v1/chat/completions`) requires `Authorization: Bearer <unified key>` on every call; the middleware hashes the presented token and compares to the stored hash.
- The Admin GUI's own CRUD endpoints are only reachable from the GUI itself (same-origin, localhost) and are not intended to be exposed beyond the local machine — no separate auth layer is placed on them in the initial build, consistent with this being a single-user local tool (see §13 for the localhost-binding requirement that makes this acceptable).
- Model resolution supports two addressing modes in the `model` field, as described in §5 step 4: a Pool's Virtual Model Name, or a `providerName/modelId` direct-addressing string for ad-hoc testing of one provider without building a Pool first.

---

## 9. Pool Engine & Load Balancing

### 9.1 Candidate list construction
For a resolved Pool, the orchestrator gathers every `PoolMember` (each pointing at one `ProviderModel`), then gathers every `ApiKey` belonging to that member's Provider. The union of all such keys across all members, filtered to those not `DISABLED` or `SUSPENDED`, forms the routable set. This set is then split into Tier 1 (`ACTIVE`) and Tier 2 (`PENALIZED`), as described in §5.

### 9.2 Ordering strategies
| Strategy | Behavior |
|---|---|
| `ROUND_ROBIN` (default) | Keys are ordered by `lastUsedAt` ascending (least-recently-used first), spreading load evenly across every account so no single free-tier quota is drained first while others sit idle. |
| `PRIORITY` | Keys are ordered by their `PoolMember.priority`, then by `lastUsedAt` within the same priority. Useful when the user wants to prefer certain provider/keys (e.g., faster or higher-quality ones) and only fall back to others. |

Tier 2 (penalized keys used as a last resort) is always ordered by soonest-expiring `penaltyExpiresAt`, regardless of the pool's chosen strategy, since the goal there is simply "give me whichever penalized key is most likely to have recovered."

### 9.3 Why Simple and Unified pools are the same engine
See §15 — a "Simple Pool" is simply a Pool with one `PoolMember`; a "Unified Pool" is a Pool with several. No branching logic is required anywhere in the orchestrator.

### 9.4 Guarantee: no premature system-level error
The orchestrator only returns a failure to the caller after **both** Tier 1 and Tier 2 have been fully exhausted. This directly satisfies requirement 06's "smart routing... does not throw any system-level error until every account in the pool has failed."

---

## 10. Health, Penalty & Suspension System

### 10.1 Error classification taxonomy
Every failed upstream call is classified into exactly one of the following, using a combination of HTTP status code and (adapter-specific) response body inspection:

| Classification | Typical signal | Resulting action |
|---|---|---|
| `QUOTA_EXCEEDED` | 402/403, or 429 whose body indicates a hard billing/quota limit rather than a short-lived rate limit | **Suspend** the key (see §10.3) |
| `RATE_LIMITED` | 429 without quota-exhaustion wording | **Penalize** the key (see §10.2) |
| `SERVER_ERROR` | 500/502/503/504 | **Penalize** the key |
| `NETWORK_ERROR` / `TIMEOUT` | connection refused, DNS failure, request timeout | **Penalize** the key |
| `AUTH_ERROR` | 401 (bad key) | **Suspend** the key with reason `invalid_credentials` — this is also terminal until the user fixes/replaces the key |
| `INVALID_REQUEST` | 400 | **Not** a key-health issue — do not penalize the key (the key itself is fine); log and move to the next candidate only if the pool has other members whose model might handle the request differently, otherwise surface immediately since retrying the same bad request elsewhere won't help either |
| `UNKNOWN` | anything unrecognized | Treated conservatively as `SERVER_ERROR` (penalized, not suspended) |

### 10.2 Escalating penalty algorithm
This implements requirements 07 and 08 precisely:

1. On a penalizing failure, if the key currently has `penaltyLevel = 0` (i.e., either never penalized, or its escalation already reset — see step 4), set `penaltyLevel = 1` and `penaltyExpiresAt = now + penaltyBaseCooldownSeconds` (default 10 minutes).
2. If the key fails again with a penalizing error **before** `penaltyResetWindowSeconds` has elapsed since its **last** `lastPenaltyEndedAt` (i.e., it's a repeat offender, not a fresh issue), increment `penaltyLevel` and set the new cooldown to `penaltyBaseCooldownSeconds × penaltyMultiplier^(penaltyLevel − 1)`, capped at `penaltyMaxCooldownSeconds`. With the documented defaults (base 10 min, multiplier 3×), this produces the exact 10 → 30 → 90 → ... minute pattern described in requirement 08.
3. When `penaltyExpiresAt` passes, the key automatically becomes eligible for Tier 1 again (checked lazily at candidate-list build time, so no background polling job is strictly required, though a periodic sweep can also proactively flip `PENALIZED → ACTIVE` in the database for GUI accuracy between requests). `lastPenaltyEndedAt` is stamped at this moment.
4. If a key remains healthy (no penalizing failure) for `penaltyResetWindowSeconds` after its `lastPenaltyEndedAt`, the **next** time it would be penalized, treat it as a fresh offense: reset `penaltyLevel` to 0 first, then apply step 1. This prevents a key that had one bad rate-limit weeks ago from being permanently treated as a repeat offender.

### 10.3 Suspension (terminal errors)
A `QUOTA_EXCEEDED` or `AUTH_ERROR` classification sets `status = SUSPENDED` and records `suspendedReason`. Suspended keys are **never** auto-retried by the timer-based mechanism and are excluded from both Tier 1 and Tier 2. They only return to `ACTIVE` via an explicit "Reactivate" action in the GUI (requirement 05's "I can remove the suspension if I want").

### 10.4 Last-resort Tier 2 fallback
As described in §5/§9, if Tier 1 is empty or every Tier 1 candidate fails during a single request, the orchestrator retries against Tier 2 (currently-penalized-but-not-suspended keys) before giving up — directly satisfying requirement 07's "penalized API keys will be re-attempted if all other keys failed... or all models faced a penalty." A successful Tier 2 attempt does **not** clear the key's penalty timer early by itself — it simply serves this one request; the timer still governs when the key returns to normal Tier 1 eligibility, since a single success under duress isn't strong enough evidence the underlying rate limit has fully cleared. (This is a deliberate conservative default — see §15.)

### 10.5 State machine

```
                         ┌──────────────┐
              ┌─────────▶│   ACTIVE      │◀───────────────────────────┐
              │           │  (healthy)    │                             │
              │           └──────┬───────┘                             │
              │                  │ call fails                           │
              │                  ▼                                     │
              │        ┌───────────────────┐                           │
              │        │  Error Classifier   │                           │
              │        └─────────┬─────────┘                           │
              │                  │                                     │
              │      ┌───────────┴────────────┐                        │
              │      ▼                         ▼                       │
              │  quota_exceeded /        rate_limited /                 │
              │  auth_error              server_error /                 │
              │      │                   network_error                 │
              │      ▼                         │                       │
              │ ┌───────────┐                   ▼                       │
              │ │ SUSPENDED  │        ┌────────────────────┐            │
              │ │ (manual     │        │     PENALIZED        │            │ cooldown
              │ │ reactivate  │        │ level += 1 (or =1)   │            │ expires
              │ │ only)       │        │ cooldown = base ×     │────────────┘
              │ └───────────┘        │ multiplier^(level-1)  │
              │       ▲                └──────────┬──────────┘
              │       │ manual                     │ new penalizing failure
              │       │ "Reactivate"                │ within reset window
              │       │ in GUI                      ▼
              └───────┴─────────────────  escalate level, extend cooldown
```

---

## 11. GUI / UX Design

### 11.1 Pages
- **Dashboard** — overview cards (providers, keys, pools counts; healthy/penalized/suspended key counts; requests today; recent failures), so the user can tell the system's health at a glance.
- **Providers** — list of providers with an aggregate health chip per provider; "Add Provider" modal; provider detail page for managing its keys and models.
- **Pools** — list of pools with type badge (derived purely from member count: 1 member badge reads "Simple", 2+ reads "Unified" — this is a display-only label, per §15), virtual model name, and live "X / Y keys healthy" summary; pool builder flow; pool detail page.
- **Logs** — filterable request history.
- **Settings** — unified gateway key management, penalty-engine defaults, general info (local server address/port to paste into Copilot).

### 11.2 "Add Provider" modal (requirement 02)
Fields, in order:
1. Provider name
2. Base URL
3. Message/API format — a select: **chat-completions**, **messages**, or **responses**
4. One or more API keys (each with a label) — an add-another-row control so several accounts can be entered for the same provider up front (requirement 03), or added later from the provider detail page
5. One or more models — for each: the provider's model id, a display name, and capability toggles (vision, function-calling)

### 11.3 Key management (requirement 05)
On each provider's detail page, each key row shows:
- Status chip with a lucide-react icon: `CircleCheck` (Active/healthy, green), `AlertTriangle` (Penalized, amber, with a live countdown to `penaltyExpiresAt` and the current `penaltyLevel`), `Ban` (Suspended, red, with the `suspendedReason`), `CircleMinus` (Disabled, gray)
- A manual **Disable/Enable** toggle
- A **Reactivate** button (visible only when Suspended) to clear suspension and return the key to Active
- Masked key value (e.g., `sk-••••••1234`) with a reveal-on-click for the full value

### 11.4 Pool builder (requirements 05 & 06)
- **Quick mode:** pick one Provider + one Model → the app creates a single-member Pool automatically, using all of that provider's currently enabled keys, and asks only for a virtual model name.
- **Advanced mode:** a multi-step builder where the user adds any number of (Provider, Model) rows from any providers, sets a routing strategy (Round Robin / Priority, with drag-to-reorder when Priority is chosen), and names the pool and its virtual model alias. This is exactly how a user builds e.g. a "no-vision-models" pool or a "vision-only" pool by filtering which Provider Models they add, using the capability tags from §6.4/§11.2 as a guide.
- Pool detail page shows every member and, nested under each, every underlying key with its live status — so the user can see at a glance exactly which of the N accounts across M providers are currently serving that pool.

### 11.5 Live status updates
Status chips (key health, pool health summaries, cooldown countdowns) refresh on a short client-side polling interval so the GUI reflects the state machine in §10.5 without requiring a manual page refresh.

---

## 12. Logging & Observability

- Every gateway request produces one or more `RequestLog` rows — one per attempted candidate (so a request that failed over through 3 keys before succeeding produces 3 rows: 2 `FAILURE` + 1 `SUCCESS`, all sharing enough context to be grouped in the Logs UI).
- The Logs page supports filtering by provider, pool, key, outcome, error classification, and date range, with an expandable row detail showing the classified error, HTTP status, latency, and which tier (1 or 2) served the attempt.
- Dashboard aggregates (requests today, failure rate, most-penalized key, etc.) are computed from `RequestLog` on read rather than maintained as separate counters, keeping the data model simple for this scale of usage.

---

## 13. Security Considerations

- **Provider API keys** are encrypted at rest (`ApiKey.secretEncrypted`) using a symmetric key derived from a secret stored only in the local environment configuration (never in the database). Decryption happens only at the moment of an outbound call.
- **Unified Gateway Key** is never stored in plaintext — only its hash is persisted; the plaintext is shown once at generation/regeneration time.
- The server should **bind to localhost by default** (not `0.0.0.0`), since it is a personal local tool and the Admin GUI endpoints carry no additional auth layer of their own.
- Basic abuse protection on the gateway endpoint (a simple in-memory rate limiter) protects against a runaway local client accidentally hammering the server and, transitively, the upstream free-tier accounts.
- No provider key value is ever written to the Request Log; logs reference keys by id/label only.

---

## 14. Configuration Reference (Defaults)

These live in `AppSettings` and are editable from the Settings page (requirement 07/08 asked for a configurable, tunable penalty system rather than hard-coded numbers):

| Setting | Default | Purpose |
|---|---|---|
| `penaltyBaseCooldownSeconds` | 600 (10 min) | First-offense penalty duration |
| `penaltyMultiplier` | 3 | Escalation factor per repeat offense within the reset window |
| `penaltyMaxCooldownSeconds` | 21600 (6 h) | Upper cap so escalation can't grow unbounded |
| `penaltyResetWindowSeconds` | 3600 (1 h) | Sustained-health duration after which escalation level resets to 0 |

Worked example with defaults, matching requirement 08 exactly: a key is penalized (level 1, 10 min). It recovers, but fails again 4 minutes after recovery (within some grace — see note below) → level 2, 30 min. It recovers, fails again shortly after → level 3, 90 min, and so on, capped at 6 hours. If instead it goes a full hour after any recovery without failing again, the next failure restarts at level 1 / 10 min.

> Note: requirement 08's "within 10 minutes after the penalty removal" is treated as an illustrative example of "shortly after recovery," not a second hard-coded number — the actual reset trigger is the configurable `penaltyResetWindowSeconds` (default 1 hour) described above, so the user can tune how forgiving the system is from the Settings page rather than it being fixed at 10 minutes.

---

## 15. Design Decisions & Assumptions

Documented explicitly so the building agent(s) understand *why*, not just *what*:

1. **Simple Pool and Unified Pool are the same underlying engine.** Requirement 06 itself describes the unified pool as "the extended feature of the first one." Rather than building two parallel routing systems, a Pool always supports any number of members; a single-member Pool behaves exactly like the "simple key pool" from requirement 05. The GUI's "Quick mode" pool creation flow (§11.4) preserves the simple, one-provider experience the user asked for, while the data model and orchestrator only need to be built once.
2. **Tier 2 (penalized-key) fallback does not clear the penalty timer.** A successful emergency-fallback call is treated as "got lucky this once," not proof the rate limit is gone, so the key still waits out its cooldown before returning to Tier 1. This is the safer default; it can be relaxed later if desired.
3. **The escalation "repeat offense" reset window is configurable, not hard-coded to 10 minutes.** See the note in §14.
4. **`INVALID_REQUEST` (HTTP 400) does not penalize the key.** A malformed request is a client-side/request-shape problem, not evidence the account itself is unhealthy, so it shouldn't count against that key's health.
5. **Direct-addressing mode (`providerName/modelId`)** is included so the user can sanity-test one specific provider/model end-to-end (Phase 5) before any Pool exists, which also gives the AI building agent a natural, minimal end-to-end milestone ahead of the full pool/health system.
6. **SQLite** is chosen over a client-server database because this is explicitly a local, single-user tool — it removes an external dependency entirely.

---

## 16. Development Phases

Each phase should be completed and verified before moving to the next. No phase depends on GUI work from a later phase to be independently testable (each backend phase is verifiable via direct HTTP calls before its GUI is built).

### Phase 0 — Project Bootstrap & Environment
- Initialize the Next.js project (TypeScript, App Router).
- Install and configure Tailwind CSS.
- Install and initialize shadCN UI (base theme, dark mode optional).
- Install lucide-react.
- Set up Prisma with a SQLite datasource.
- Create the local environment configuration for: the database file location, the secret used to encrypt provider API keys, and the port the app runs on.
- Establish the project's folder conventions (routes, a core "engine" module area for the orchestrator/adapters/health logic, a components area, the Prisma schema location).
- **Acceptance:** the app boots and serves an empty placeholder page; `prisma migrate` runs successfully against a trivial placeholder model.

### Phase 1 — Data Model
- Implement the full Prisma schema exactly as specified in §6: `Provider`, `ApiKey`, `ProviderModel`, `Pool`, `PoolMember`, `RequestLog`, `AppSettings`, with all enums as described.
- Run the initial migration and generate the client.
- Build a thin internal data-access layer (one module per entity) with basic create/read/update/delete functions — not yet exposed as HTTP endpoints.
- Add a one-time startup seed that creates the singleton `AppSettings` row (generating and hashing a fresh Unified Gateway Key, and populating the default penalty settings from §14) if it doesn't already exist.
- **Acceptance:** Prisma Studio (or equivalent inspection) shows all tables correctly related; on first boot, exactly one `AppSettings` row exists with sensible defaults.

### Phase 2 — Secrets Handling
- Implement an encryption/decryption utility for provider API key secrets, keyed off the environment secret from Phase 0.
- Implement generation and hash-verification for the Unified Gateway Key (plaintext shown only once, hash stored).
- Implement a masking helper for displaying keys in the GUI (e.g., first/last few characters only).
- **Acceptance:** a value encrypted by the utility decrypts back to the original; a freshly generated gateway key's plaintext verifies successfully against its own stored hash, and a tampered/incorrect value does not.

### Phase 3 — Admin CRUD APIs
- Build internal API routes for full CRUD on `Provider`, `ApiKey` (scoped under a provider), and `ProviderModel` (scoped under a provider), with input validation (valid URL, valid enum values, non-empty required fields).
- Implement the business rule that a Provider cannot be deleted while one of its models is referenced by any `PoolMember` (return a clear error naming the blocking pool(s) instead).
- Implement key state–changing actions as part of this phase's API surface: enable/disable (manual), and reactivate-from-suspension.
- **Acceptance:** every entity can be created, listed, updated, and deleted through these routes, verified independently of any GUI (e.g., via direct HTTP calls), including the delete-blocking rule.

### Phase 4 — Provider Adapter Layer
- Define the Canonical Request and Canonical Response shapes described in §7.1.
- Build the three adapters (`CHAT_COMPLETIONS`, `MESSAGES`, `RESPONSES`), each implementing the four responsibilities from §7.3: outbound request build, non-streaming response parse, streaming chunk parse, and error body parse.
- Build the outbound serializer that turns a Canonical Response (or canonical stream deltas) into an OpenAI chat-completions–shaped response/SSE stream, independent of which adapter produced it.
- **Acceptance:** using one real, manually-configured key per dialect (at least one provider of each of the three formats), a raw canonical request produces a correct provider-native call and the response comes back correctly normalized, for both streaming and non-streaming, regardless of which of the three providers answered.

### Phase 5 — Direct Gateway Endpoint (No Pools Yet)
- Build the public gateway endpoint and its Bearer-token auth middleware (§8).
- Implement the direct-addressing resolution mode (`providerName/modelId`) only — Pool resolution comes in Phase 7.
- Wire the endpoint through to the Phase 4 adapter layer for a single, specific key (the first enabled key found for that provider, no pooling logic yet).
- Write every attempt to `RequestLog`.
- **Acceptance:** a real client (curl, or Copilot pointed at this endpoint with direct-addressing) gets a working, correctly-streamed response end-to-end through at least one real provider.

### Phase 6 — Health, Penalty & Suspension Engine
- Implement the Error Classifier (§10.1): status-code baseline rules plus adapter-specific hooks for interpreting each dialect's error body shape.
- Implement the key state machine transitions exactly as specified in §10.2–§10.5: penalizing a key (with correct escalation math and the reset-window rule), suspending a key, automatic penalty expiry, and manual suspension-clearing.
- Wire failure outcomes from Phase 5's gateway endpoint into this engine so a real failing call actually transitions key state.
- **Acceptance:** using a documented manual test plan (e.g., pointing a test Provider at an endpoint or stub that reliably returns 429/500/402/401), verify: first penalty = base cooldown; a second qualifying failure within the reset window escalates correctly per the multiplier and cap; a quota/auth failure suspends immediately and does not auto-recover after waiting; and a key that goes quiet for the full reset window is treated as a fresh offender on its next failure.

### Phase 7 — Pool Engine & Failover Orchestrator
- Build CRUD for `Pool` and `PoolMember`, including the "Quick mode" helper that auto-builds a single-member pool from one chosen Provider + Model, using that provider's currently enabled keys.
- Build the Failover Orchestrator exactly as specified in §5/§9/§10.4: Tier 1 / Tier 2 candidate list construction, per-strategy ordering, iterate-until-success-or-exhausted looping, and the aggregated multi-candidate error when everything fails.
- Update the gateway endpoint's Model Resolver to check Pool virtual model names before falling back to direct-addressing.
- **Acceptance:** with a pool containing several keys (including at least one deliberately broken key), repeated requests demonstrate automatic failover to a working key with no error surfaced to the client; forcing every Tier 1 key to fail while a Tier 2 (penalized) key exists demonstrates the last-resort fallback described in §10.4; forcing every key in the pool to fail demonstrates the single aggregated error response.

### Phase 8 — Admin GUI: Providers, Keys & Models
- Build the shared shadCN layout shell: sidebar navigation (using lucide-react icons) and page scaffolding for Dashboard, Providers, Pools, Logs, Settings.
- Build the Providers list page and the "Add Provider" modal exactly as specified in §11.2, including the multi-key and multi-model add-another-row inputs.
- Build the Provider detail page's key list (status chips, disable/enable, reactivate, masked-key reveal) and model list (add/edit/delete, capability toggles), per §11.3.
- **Acceptance:** a provider, its keys, and its models can be fully configured from the GUI alone, and the status chips accurately reflect the Phase 6 engine's live state (verified by forcing a failure via the gateway and watching the chip update on the next poll).

### Phase 9 — Admin GUI: Pool Builder & Dashboard
- Build the Pools list page (member-count-derived Simple/Unified badge, virtual model name, live healthy-key summary).
- Build the Quick-mode and Advanced-mode pool creation flows described in §11.4, including drag-to-reorder priority when the Priority strategy is chosen.
- Build the Pool detail page showing every member and, nested underneath, every underlying key's live status.
- Build the Dashboard's overview cards.
- **Acceptance:** both pool-creation modes produce pools that route correctly per Phase 7's orchestrator, verified end-to-end from the GUI through to a real gateway call.

### Phase 10 — Admin GUI: Logs & Settings
- Build the Logs page: filterable/sortable table over `RequestLog`, with an expandable detail row.
- Build the Settings page: view/regenerate the Unified Gateway Key (show-once pattern), edit the four penalty-engine defaults from §14, and display the local server address/port for pasting into Copilot's configuration.
- **Acceptance:** a failure injected via the gateway is fully traceable and diagnosable from the Logs page alone; changing a penalty setting in the GUI measurably changes the engine's behavior on the next test failure.

### Phase 11 — Streaming Hardening, Copilot Compatibility & Final Verification
- Verify and refine SSE streaming through the complete stack (adapter → orchestrator → serializer → client) so tokens stream smoothly with no buffering artifacts in VS Code Copilot Chat specifically.
- Add request timeout handling and propagate client-side disconnects/aborts down to the in-flight upstream call.
- Confirm the server binds to localhost only by default, and add the basic gateway-endpoint rate limiter from §13.
- Produce a short manual test/runbook checklist covering: registering one provider per dialect; building both a Quick-mode and an Advanced-mode pool; forcing each error classification at least once and confirming the correct state-machine outcome; confirming multi-cycle escalation math; confirming suspension requires manual reactivation; and configuring VS Code Copilot's custom endpoint settings to point at this gateway with the Unified Gateway Key.
- **Acceptance:** a real VS Code Copilot Chat session, configured against this local gateway, completes a full conversation using a Unified Pool spanning at least two different providers, including at least one observed mid-session failover.

---

## 17. Glossary

- **Free-tier account pooling** — using multiple separate free-quota accounts (from the same or different providers) as if they were one larger quota, by automatically switching between them.
- **Canonical shape** — the internal, provider-agnostic representation of a request/response used throughout the routing engine.
- **Tier 1 / Tier 2** — the two-pass retry cascade: first pass over healthy keys, second (last-resort) pass over currently-penalized-but-not-suspended keys, used only if the first pass is empty or fully fails.
- **Escalation level** — a per-key counter that increases each time the key is penalized again before it has had a full "reset window" of good health, driving the exponential 10 → 30 → 90-minute-style cooldown growth.
