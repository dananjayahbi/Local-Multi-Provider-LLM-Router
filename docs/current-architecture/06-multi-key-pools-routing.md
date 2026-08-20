# Document 06 — Multi-Key Pools, Caching-Aware Routing & Copilot Injection

> **Status**: DESIGN (v1). Validated incrementally via the Playground before touching the production schema/orchestrator.
> **Last Updated**: 2026-08-20

---

## 1. Motivation

Today the router exposes **one unified gateway key** and each provider owns a set of
`ApiKey`s that are routed through pools (`Pool` → `PoolMember` → `ProviderModel` →
`Provider.apiKeys`). This makes it impossible to give **different pools their own API
keys** and impossible to attach **multiple limit-configured keys to a single pool**.

The goals of this redesign:

| # | Goal |
|---|---|
| 01 | One **system gateway key per pool** (always visible, copyable — no hide/encryption). |
| 02 | Each pool owns **N provider keys**, each with its own RPM / TPM / RPD / TPD / TPS / TTFT / context-window limits. |
| 03 | **Provider-level prompt caching** is honored — stay on a key to preserve the cached prefix and its discount. |
| 04 | Use a key **until it hits a limit**, then apply a **penalty scaled to the limit type** and move to the next key. |
| 05 | The selector is **input-token aware** (context fit, exhaustability priority, caching-loss cost on rotation). |
| 06–07 | With **Copilot BYOK**, surface "hit a limit → switch vs. compact chat" through Copilot's `askQuestion` tool (prompt-injection style). |
| 09 | A **Playground** page to prove each piece experimentally with mock providers before production wiring. |

> **Task 08** (agent/discovery/testing) is intentionally deferred.

---

## 2. Target Data Model

### 2.1 Pool gateway keys (Task 01)

Each `Pool` gets its own plaintext gateway key so the user can authenticate per-pool in
Copilot BYOK and other OpenAI-compatible clients. Because this is a local, single-user
router, the key is **stored and displayed in plaintext** and can always be copied.

```prisma
model Pool {
  id                String  @id @default(cuid())
  name              String
  virtualModelName  String  @unique
  description       String?
  routingStrategy   String  @default("ROUND_ROBIN") // KEY_AWARE (new)
  gatewayKey        String? @unique   // plaintext per-pool key, e.g. sk-pool-...
  gatewayKeyPrefix  String?           // masked preview for list view
  // caching-aware routing controls
  cacheAware        Boolean @default(true)
  stickyContextTokenBudget Int @default(0) // keep same key while context grows below this
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

The old `AppSettings.unifiedGatewayKeyHash` becomes a fallback only (or is dropped in a
later migration).

### 2.2 Keys scoped to Pool + Provider (Task 02)

Today a key belongs to `Provider`. In the new model a key belongs to **both a Pool and a
Provider**, so different pools can have independent sets of keys from the same providers.
Provider API keys are stored plaintext (`secret`) and always copyable.

```prisma
model ApiKey {
  id             String  @id @default(cuid())
  poolId         String                 // NEW — key is owned by a pool
  providerId     String
  label          String
  secret         String                 // plaintext (local single-user)
  secretEncrypted String?               // kept only for backward-compat reads

  // ── rate / token limits ──
  rpmLimit       Int?
  tpmLimit       Int?
  rpdLimit       Int?                   // NEW requests/day
  tpdLimit       Int?                   // NEW tokens/day
  tps            Float?                 // NEW tokens/sec (speed)
  timeToFirstTokenMs Int?               // NEW
  contextWindow  Int?                   // NEW max context tokens
  cacheCapable   Boolean @default(true) // NEW provider supports prompt caching
  cacheDiscountFactor Float @default(0.1) // NEW cached-token price fraction

  // ── health / lifecycle (unchanged) ──
  status, manuallyDisabled, penaltyLevel, penaltyExpiresAt,
  lastPenaltyEndedAt, suspendedReason, consecutiveFailures,
  calibrated, lastCalibratedAt, lastUsedAt, createdAt, updatedAt

  pool       Pool      @relation(...)
  provider   Provider  @relation(...)
}
```

The `PoolMember` link is retained so a pool still knows which provider *models* it can
serve; the pool's *keys* are the intersection of its own `ApiKey`s and the member's
provider.

---

## 3. Runtime Budget & Limit Semantics (Tasks 02–04)

Each key maintains **rolling windows** in memory (mirrors the existing
`api-key-rate-limiter.ts`):

| Limit | Window | Unit | On hit |
|---|---|---|---|
| `RPM` | 60 s | requests | penalize **~1 min** |
| `TPM` | 60 s | tokens | penalize **~2 min** |
| `RPD` | 24 h | requests | penalize **~24 h** |
| `TPD` | 24 h | tokens | penalize **~24 h** |
| `contextWindow` | per-request | tokens | **skip for request** (no global penalty) |
| `TPS` / `TTFT` | n/a | scoring | affects candidate ordering, not penalty |

### 3.1 Penalty scaling (Task 04)

Penalty duration is chosen **from the limit that was hit**, not a uniform backoff:

```ts
const LIMIT_PENALTY_S = {
  RPM: 60,        // window clears in ≤60s
  TPM: 120,
  RPD: 24*3600,   // "putting 10 minutes on a TPD hit is useless"
  TPD: 24*3600,
};
```

Key is marked `PENALIZED` with `penaltyExpiresAt`; the selector skips penalized keys
unless no ACTIVE key can serve the request.

---

## 4. Caching-Aware Key Selection (Tasks 03 & 05)

### 4.1 The core tension

Prompt caching discounts the **shared prefix** between consecutive requests. On a long
chat the prefix grows (e.g. 50k → 55k tokens), so the *cached* 50k tokens bill at the
discounted rate. **Rotating keys discards that cached prefix** — the next key bills the
raw 50k+ tokens and may exceed its own context window or TPM.

### 4.2 Selection pipeline

```
input: request { promptTokens, completionBudget }, conversation { currentKeyId }

1. FILTER   – drop DISABLED / SUSPENDED / penalized-unless-forced keys.
2. FIT      – drop keys where contextWindow < promptTokens + completionBudget.
3. CACHE    – if conversation.currentKeyId is in the pool, still fits, and its
              nearest hard limit isn't imminent → STRONG STICKY BONUS (stay put).
4. SCORE    – for the rest, score by:
     exhaustability  (higher utilization = more likely to exhaust = preferred)
     contextFit      (smallest window that fits, for small prompts)
     costOfRotation  (cachedTokens that would be lost if switching)
     speed           (tps, ttft) as tiebreaker
5. RANK     – pick best; on hit, apply scaled penalty + re-rank.
```

### 4.3 Sticky budget

The router keeps `stickyContextTokenBudget` per pool: while `currentPromptTokens` stays
under the current key's context window **minus** this budget, prefer staying on the
current key — even if a slightly-better-scoring key exists — to protect the cache.

### 4.4 Cost of rotation

`lostCacheTokens = min(lastPromptTokens, currentPromptTokens)` (prefix overlap). When
comparing switching from key A to key B, add `lostCacheTokens * cacheDiscountFactor` as a
virtual penalty against switching, so rotation only happens when a real limit forces it.

### 4.5 Exhaustability priority (Task 05)

Budget utilization per key = `max(rpm/rpmLimit, tpm/tpmLimit, rpd/rpdLimit,
tpd/tpdLimit, contextUsed/contextWindow)`. The selector prefers keys **closer to
exhaustion** so it burns them in order and "jumps to the middle/top" only when a large
request needs a big context window — matching the user's requirement.

### 4.6 Input-token awareness (Task 05)

- `promptTokens` comes from the gateway request; if the client doesn't send it, estimate
  it (existing `token-estimator.ts`).
- Small prompts → lowest fitting context window (don't waste the big one).
- Big prompts → only keys whose context window fits; among those, prefer the largest
  remaining budget.

---

## 5. Copilot `askQuestion` Injection (Tasks 06–07)

Copilot's agent exposes an `askQuestion` tool that can pause a run and present choices to
the user. In **BYOK mode** the agent's model calls the router. The router cannot invoke
Copilot's tool directly; instead it **injects an instruction into the outgoing request**
that asks the model to surface a choice via `askQuestion`.

### 5.1 Trigger

When a key hits a *limit* mid-conversation and the router is about to rotate, it injects
a prompt of the form:

```
[ROUTER-GUIDANCE]
The API key "{{key}}" just hit the {{limitName}} limit.
Options:
  A. Continue on the next most reliable key with the current (uncached) context.
  B. Ask the user to compact/summarize this chat first, then continue.
Please present this decision to the user via the askQuestion tool before the next turn.
If the user chooses to compact, call askQuestion again after summarizing.
[/ROUTER-GUIDANCE]
```

> This is **experimental** — behavior depends on the agent's model and tool policy. The
> Playground's **Injection Lab** lets us iterate on phrasing and observe the injected
> payload before production use.

### 5.2 Decision surfacing

- The gateway appends the guidance to the `system`/context of the *next* request after a
  rotation, or emits it as a streamed assistant meta-event.
- Options presented: **"Go to the next one directly"** (proceed) and **"Compact the
  chat"** (user presses the summarization button manually in auto-approval mode, then
  continues).

---

## 6. Playground (Task 09) — the validation harness

The Playground (`/playground`) is the experiment surface. It contains two labs backed by
**pure, testable modules** under `src/engine/playground/`:

### 6.1 Algorithm Simulator

- Build a **mock provider pool**: several simulated keys, each with rpm/tpm/rpd/tpd/tps/
  ttft/context/cache settings.
- **Script a workload**: a long stream of text / a series of requests with growing
  `promptTokens`.
- **Mechanically inject errors**: hit RPM, TPM, RPD, TPD, context overflow, quota, auth —
  one at a time — and watch the selector:
  - pick a key, apply a **scaled penalty**,
  - rotate while reporting **cached-token loss**,
  - emit an **injection event** when it wants the user to decide.
- Render the full decision trace (which key, why, penalty applied, cache saved/lost).

### 6.2 Injection Lab

- Craft the Copilot `askQuestion` guidance text (pre-defined templates + variables).
- Preview the exact payload that would be injected into the next request.
- Copy the payload for manual experimentation.

### 6.3 Reusable modules

| File | Responsibility |
|---|---|
| `types.ts` | `SimKey`, `SimUsage`, `RequestSpec`, `Decision`, `TraceEvent`, etc. |
| `budget.ts` | rolling-window accounting for rpm/tpm/rpd/tpd + utilization |
| `selector.ts` | caching-aware ranking pipeline (§4) |
| `penalty.ts` | limit→cooldown mapping + penalty application (§3.1) |
| `mock-provider.ts` | simulated keys that mechanically produce errors |
| `scenario.ts` | scripted workload + error-injection scenarios |
| `injection.ts` | Copilot `askQuestion` guidance builder (§5) |

---

## 7. Rollout Plan

1. ✅ **Playground** (this session) — prove selector + penalty + injection against mocks.
2. ✅ **Schema migration** — `Pool.gatewayKey/gatewayKeyPrefix/cacheAware/stickyContextTokenBudget`,
   `ApiKey.poolId + secret + rpd/tpd/tps/ttft/context/cache*`, plaintext `secret` (Task 01–02).
3. ✅ **Rate limiter** — RPD/TPD 24h windows + `getKeyUsageSnapshot` for the selector (Task 04).
4. ✅ **Caching-aware selector** wired into `orchestrator` via `src/engine/routing/`
   (reuses the tested playground `selectKey`); per-pool conversation affinity (Task 03–05).
5. ✅ **Per-pool gateway key auth** in the gateway route (with legacy unified-key fallback) (Task 01).
6. ✅ **Copilot injection** — orchestrator records pending rotation injection; gateway appends
   `[ROUTER-GUIDANCE]` to the next request (Task 06–07).
7. ✅ **Admin UI** — pool list/detail show plaintext copyable gateway keys + regenerate; pool owns
   keys with full limit editors; plaintext secret copy; add-key-to-pool dialog.
8. ⏳ (Deferred) agent/discovery/benchmarking against the new model (Task 08). Benchmark runner
   updated to read plaintext `secret`.

---

## 8. Concrete Schema Migration Steps (Tasks 01–02)

> Run after the algorithm is proven in the Playground. Local single-user → plaintext keys.

### 8.1 `ApiKey` — scope to Pool, add limits, plaintext secret

```prisma
model ApiKey {
  id             String  @id @default(cuid())
  poolId         String            // NEW — key owned by a pool
  providerId     String
  label          String
  secret         String            // NEW plaintext (local single-user)
  secretEncrypted String?          // kept for backward-compat / migration reads

  rpmLimit       Int?
  tpmLimit       Int?
  rpdLimit       Int?              // NEW
  tpdLimit       Int?              // NEW
  tps            Float?            // NEW
  timeToFirstTokenMs Int?          // NEW
  contextWindow  Int?              // NEW
  cacheCapable   Boolean @default(true) // NEW
  cacheDiscountFactor Float @default(0.1) // NEW

  pool       Pool      @relation(fields: [poolId], references: [id], onDelete: Cascade)
  provider   Provider  @relation(fields: [providerId], references: [id], onDelete: Cascade)
  // ...existing health/lifecycle fields unchanged
}
```

### 8.2 `Pool` — per-pool gateway key + routing controls

```prisma
model Pool {
  id                String  @id @default(cuid())
  name              String
  virtualModelName  String  @unique
  description       String?
  routingStrategy   String  @default("KEY_AWARE") // replaces ROUND_ROBIN default
  gatewayKey        String? @unique   // plaintext per-pool key, always copyable
  gatewayKeyPrefix  String?
  cacheAware        Boolean @default(true)
  stickyContextTokenBudget Int @default(0)
  // ...existing timestamps
}
```

### 8.3 Migration steps

1. `prisma migrate dev --name multi-key-pools` — add columns; make `poolId` nullable first,
   backfill existing keys into a default "Main" pool, then set non-null.
2. Decrypt existing `secretEncrypted` → write to `secret`; drop encryption for new writes.
3. Update `data-access/api-keys.ts`, `pools.ts`, `providers.ts` and the admin API + UI
   (pool detail now lists its own keys with full limit editors; keys always show plaintext).
4. Update `lib/api-key-rate-limits.ts` `parseRateLimitInput` for rpd/tpd; add a
   `contextWindow` parse.
5. Add `Pool.gatewayKey` generation + verification (reuse `gateway-key.ts` helpers, but
   plaintext per-pool).

### 8.4 Gateway auth (per-pool key)

- `/api/gateway/v1/...` currently verifies the single unified key. Change to: resolve the
  pool by `virtualModelName`, verify the bearer key against `Pool.gatewayKey`.
- VS Code Copilot BYOK: point the base URL at `http://localhost:4006/v1` and use the
  **pool's** gateway key as the API key. Different pools → different keys.

