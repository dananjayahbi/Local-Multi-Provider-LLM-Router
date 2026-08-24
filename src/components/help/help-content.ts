// ─── Help Page Content ──────────────────────────────────
// Structured, self-contained content for the /help page. Keeping the diagrams
// and prose as data (rather than inline JSX) separates content from rendering,
// so the page component stays small and the knowledge is reusable/maintainable.

export interface DiagramBlock {
  title: string;
  chart: string;
  caption?: string;
}

export interface ScenarioBlock {
  id: string; // anchor / card id
  title: string;
  summary: string;
  level: "basic" | "intermediate" | "advanced";
  chart: string;
  walkthrough: string[];
  outcome: string;
}

// ─── Architecture Overview ─────────────────────────────

export const SYSTEM_OVERVIEW: DiagramBlock[] = [
  {
    title: "High-Level System Architecture",
    chart: `graph TB
      subgraph Clients["Clients"]
        C1["VS Code Copilot"]
        C2["OpenAI-Compatible App"]
        C3["Custom Client"]
      end

      subgraph Router["LLM Router (Next.js 16, port 4006)"]
        GW["Gateway API POST /api/gateway/v1/chat/completions"]
        ADMIN["Admin API /api/admin/*"]
        UI["Admin Dashboard (React 19 + Tailwind v4)"]
        ENG["Engine Layer (Orchestrator + Adapters + Health)"]
        DA["Data Access Layer (Prisma 7)"]
        RL["Rate Limiter (in-memory sliding window)"]
      end

      subgraph Upstream["Upstream Providers"]
        P1["OpenAI"]
        P2["Anthropic"]
        P3["Groq"]
        P4["Together"]
        P5["Mistral"]
        P6["Any OpenAI-compatible"]
      end

      subgraph Storage["Storage"]
        DB[("SQLite via libSQL")]
      end

      C1 -->|"Bearer token"| GW
      C2 -->|"Bearer token"| GW
      C3 -->|"Bearer token"| GW
      UI -->|"REST"| ADMIN
      GW --> ENG
      ADMIN --> DA
      ENG --> DA
      ENG --> RL
      ENG -->|"HTTP"| P1
      ENG -->|"HTTP"| P2
      ENG -->|"HTTP"| P3
      ENG -->|"HTTP"| P4
      ENG -->|"HTTP"| P5
      ENG -->|"HTTP"| P6
      DA --> DB`,
    caption: "The gateway is the single entry point. All routing, health and logging happen behind it.",
  },
  {
    title: "Engine Module Map",
    chart: `graph LR
      subgraph Engine["Engine Layer"]
        ORCH["orchestrator.ts"]
        CANON["canonical.ts"]
        ERR["error-classifier.ts"]
        HEALTH["health-engine.ts"]
        NORM["response-normalizer.ts"]
        SER["serializer.ts"]
        SEL["routing/selector.ts"]
        PEN["penalty-application.ts"]
        ADAPTER["adapters/"]
        ACL["benchmark/auto-calibration.ts"]
      end

      ORCH --> CANON
      ORCH --> ADAPTER
      ORCH --> ERR
      ORCH --> HEALTH
      ORCH --> NORM
      ORCH --> SEL
      ORCH --> PEN
      HEALTH --> PEN
      HEALTH --> ACL
      SEL --> CANON
      ADAPTER --> CANON
      ADAPTER --> NORM
      SER --> CANON
      NORM --> SER`,
    caption: "The orchestrator coordinates adapters, selector, health and normalization.",
  },
  {
    title: "Request Lifecycle (Streaming)",
    chart: `sequenceDiagram
      participant Client
      participant Gateway
      participant Orchestrator
      participant Adapter
      participant Provider

      Client->>Gateway: POST /chat/completions (stream=true)
      Gateway->>Gateway: Auth (pool gateway key / unified)
      Gateway->>Gateway: Resolve pool by virtualModelName
      Gateway->>Orchestrator: orchestrate(canonicalRequest, pool)
      Orchestrator->>Orchestrator: buildCandidates + order (selector)
      Orchestrator->>Adapter: buildRequest(request, key, baseUrl, modelId)
      Adapter->>Provider: HTTPS POST
      Provider-->>Adapter: SSE stream
      Adapter-->>Orchestrator: parseStreamChunk (CanonicalDelta)
      Orchestrator-->>Gateway: streamGenerator
      Gateway-->>Client: SSE chunks + [DONE] + terminal stop`,
    caption: "Streaming flows through the provider as SSE, normalized to canonical deltas, then re-serialized to the client.",
  },
  {
    title: "Penalty State Machine",
    chart: `stateDiagram-v2
      [*] --> ACTIVE
      ACTIVE --> PENALIZED: recoverable error (rate-limit / server / network)
      ACTIVE --> SUSPENDED: quota exceeded / auth error
      PENALIZED --> ACTIVE: cooldown expires (or manual reset)
      PENALIZED --> SUSPENDED: terminal error during cooldown
      SUSPENDED --> ACTIVE: manual reactivate
      ACTIVE --> DISABLED: manual disable
      DISABLED --> ACTIVE: manual enable
      ACTIVE --> TESTING: benchmark begins
      TESTING --> COOLDOWN: benchmark done
      COOLDOWN --> ACTIVE: cooldown expires`,
    caption: "Keys move through health states; only ACTIVE keys are routable.",
  },
  {
    title: "Data Model (Prisma)",
    chart: `erDiagram
      PROVIDER ||--o{ APIKEY : "owns"
      PROVIDER ||--o{ PROVIDERMODEL : "serves"
      PROVIDERMODEL ||--o{ POOLMEMBER : "member"
      POOL ||--o{ POOLMEMBER : "contains"
      POOL ||--o{ POOLAPIKEY : "attaches"
      APIKEY ||--o{ POOLAPIKEY : "shared into"
      REQUESTLOG }o--|| APIKEY : "timestamps"
      REQUESTLOG }o--|| POOL : "timestamps"
      REQUESTLOG }o--|| PROVIDERMODEL : "timestamps"

      PROVIDER {
        string id PK
        string name
        string baseUrl
        string apiFormat
      }
      APIKEY {
        string id PK
        string providerId FK
        string label
        string secret
        int rpmLimit
        int tpmLimit
        string status
        string penaltyType
      }
      PROVIDERMODEL {
        string id PK
        string providerId FK
        string modelId
        string displayName
        int contextWindow
        boolean reliableToolCalling
      }
      POOL {
        string id PK
        string name
        string virtualModelName
        string routingStrategy
        string gatewayKey
        boolean cacheAware
      }
      REQUESTLOG {
        string id PK
        string outcome
        string errorClassification
        string providerErrorMessage
        string gatewayErrorMessage
      }`,
    caption: "Keys are provider-level and shared into pools via the PoolApiKey join.",
  },
  {
    title: "Selection Pipeline (Cache-Aware)",
    chart: `flowchart TD
      A["Input: request {promptTokens, completionBudget}<br/>& conversation {currentKeyId}"] --> B
      B["1. FILTER<br/>drop DISABLED / SUSPENDED keys"] --> C
      C["2. FIT<br/>drop keys where contextWindow < prompt + budget"] --> D
      D["3. CACHE<br/>currentKey in pool & fits & no imminent hard limit?<br/>→ STRONG STICKY BONUS"] --> E
      E["4. SCORE<br/>exhaustability + contextFit + costOfRotation + speed"] --> F
      F["5. RANK<br/>pick best; on hit apply scaled penalty + re-rank"] --> G
      G["Chosen key for this request"]`,
    caption: "The selector ranks keys by stickiness, exhaustability, context-fit and rotation cost.",
  },
];

// ─── Scenarios ──────────────────────────────────────────

export const SCENARIOS: ScenarioBlock[] = [
  {
    id: "scn-basic-success",
    title: "Basic Success — Pool Routes to One Healthy Key",
    summary: "A single key is ACTIVE; the request is served end-to-end.",
    level: "basic",
    chart: `sequenceDiagram
      participant Client
      participant Gateway
      participant Orch as Orchestrator
      participant KeyA as API Key A (ACTIVE)
      participant Provider
      Client->>Gateway: POST chat/completions (model="Ox-Alpha-R")
      Gateway->>Gateway: Auth + resolve pool
      Gateway->>Orch: orchestrate()
      Orch->>Orch: buildCandidates → [KeyA]
      Orch->>KeyA: attempt (no rate-limit wait if under limit)
      KeyA->>Provider: HTTPS request
      Provider-->>KeyA: 200 response
      KeyA-->>Orch: CanonicalResponse
      Orch-->>Gateway: success
      Note over Orch: resetKeyHealth + auto-calibration success
      Gateway-->>Client: 200 JSON (or SSE stream)`,
    walkthrough: [
      "The gateway authenticates the request with the pool's gateway key and resolves the virtual model name to a pool.",
      "The orchestrator builds the candidate list — only keys with status ACTIVE are routable.",
      "It picks Key A, checks rate-limit capacity, and forwards the provider request.",
      "On success it records usage, resets health counters and feeds auto-calibration.",
      "The response is normalized and returned to the client as a standard OpenAI completion.",
    ],
    outcome: "HTTP 200, one clean completion. No penalty, no rotation.",
  },
  {
    id: "scn-key-penalized-failover",
    title: "Failover — Primary Key Penalized, Second Key Serves",
    summary: "Key A hits a rate limit and is penalized; the orchestrator retries on Key B.",
    level: "basic",
    chart: `flowchart TD
      R["Request arrives"] --> A["Try Key A (ACTIVE)"]
      A -->|"Provider returns 429 / rate limit"| F["Apply penalty to A<br/>type=PRE_DEFINED reason=RPM"]
      F --> L["Log FAILURE (provider + gateway error)"]
      L --> B["Try Key B (ACTIVE)"]
      B -->|"Success"| S["Return 200<br/>reset Key B health"]
      B -->|"Also fails"| NEXT["Continue failover loop / exhaust"]`,
    walkthrough: [
      "The orchestrator tries the first candidate. The provider responds non-OK (e.g. 429 rate limit).",
      "`applyFailure` classifies the error; a 429 with no detectable limit defaults to an RPM penalty.",
      "The key becomes PENALIZED with a ~1-minute cooldown, and the FAILURE is logged with both sides of the error.",
      "The loop `continue`s to the next candidate, which serves the request successfully.",
      "The successful key's health counters reset and auto-calibration records a success.",
    ],
    outcome: "The user still gets a 200. Key A recovers after its cooldown; Key B now handles traffic.",
  },
  {
    id: "scn-suspend-quota",
    title: "Quota Exceeded → Key Suspended",
    summary: "A key hits a quota/403 and is permanently suspended until manual reactivation.",
    level: "basic",
    chart: `stateDiagram-v2
      [*] --> ACTIVE
      ACTIVE -->|"402 / 403 quota signal"| SUSPENDED
      SUSPENDED -->|"manual reactivate (Reactivate button)"| ACTIVE
      ACTIVE -->|"auth error (401/403)"| SUSPENDED
      SUSPENDED -->|"manual reset-penalty"| ACTIVE`,
    walkthrough: [
      "`error-classifier` maps 402/403 and quota-wording to QUOTA_EXCEEDED; auth failures map to AUTH_ERROR.",
      "Both are terminal, so `applyFailure` sets the key to SUSPENDED instead of a timed penalty.",
      "Suspended keys are excluded from routing entirely — no retry happens on them.",
      "The user must manually reactivate (or reset) from the UI once the quota is topped up.",
    ],
    outcome: "The key is out of rotation until a human intervenes. No automatic cooldown.",
  },
  {
    id: "scn-no-healthy-key",
    title: "Exhausted Pool → Predefined Gateway Response (No Error)",
    summary: "Every key is unroutable; the gateway returns a 200 assistant message instead of a 502.",
    level: "advanced",
    chart: `sequenceDiagram
      participant Client
      participant Gateway
      participant Orch as Orchestrator
      Client->>Gateway: POST chat/completions
      Gateway->>Orch: orchestrate()
      Orch->>Orch: buildCandidates → [] (no ACTIVE keys)
      alt No routable keys
        Orch->>Orch: log FAILURE (NO_HEALTHY_KEY)
        Orch-->>Gateway: {success:false, exhaustedPool:true}
        Gateway-->>Client: 200 assistant completion "pool is exhausted, wait for penalty removal"
      else Some keys exist
        Orch-->>Gateway: {success:false} → 502 error
      end`,
    walkthrough: [
      "All keys are PENALIZED, SUSPENDED, DISABLED, or the pool holds no ACTIVE key.",
      "The orchestrator returns `exhaustedPool: true` and logs a `NO_HEALTHY_KEY` failure row.",
      "Instead of a 502, the routes return a valid assistant completion — no `tool_calls`, `finish_reason: stop`.",
      "Copilot's agent loop sees a final text message and ends the turn (session.idle) instead of retrying forever.",
    ],
    outcome: "No hard error. The agent is told to wait and ends the conversation cleanly.",
  },
  {
    id: "scn-exhaust-after-failover",
    title: "All Attempted Keys Fail → Exhausted",
    summary: "Every key was tried and failed in one request; the pool is now exhausted.",
    level: "advanced",
    chart: `flowchart LR
      A["Key A fails<br/>(rate-limited)"] --> B["Key B fails<br/>(server error)"]
      B --> C["Key C fails<br/>(network error)"]
      C --> D["Loop ends: all candidates exhausted"]
      D --> E["return {success:false, exhaustedPool:true}"]
      E --> F["gateway returns 200 predefined message"]`,
    walkthrough: [
      "The orchestrator iterates the ordered candidates in failover order.",
      "Each key applies its own penalty (pre-defined or variable) and logs a FAILURE.",
      "After the loop ends with no success, it returns `exhaustedPool: true`.",
      "The caller returns the predefined assistant completion so the agent stops rather than looping.",
    ],
    outcome: "The request is served by the exhausted-pool response; all failing keys are now cooling down.",
  },
  {
    id: "scn-variable-penalty-escalation",
    title: "Variable Penalty Escalation (Exponential Backoff)",
    summary: "A key keeps hitting a generic recoverable error; cooldown grows each time.",
    level: "intermediate",
    chart: `flowchart TD
      S["Settings: base=600s mult=3 max=21600 resetWindow=3600s"] --> L1
      subgraph Consecutive["Failures within reset window"]
        L1["Failure 1 → level 1<br/>600 × 3^0 = 600s"]
        L2["Failure 2 → level 2<br/>600 × 3^1 = 1800s"]
        L3["Failure 3 → level 3<br/>600 × 3^2 = 5400s"]
        L4["Failure 4+ → capped at 21600s"]
      end
      L1 --> L2 --> L3 --> L4
      R["After >3600s since last penalty ended → reset to level 1"] --> L1`,
    walkthrough: [
      "A generic recoverable error (SERVER_ERROR, NETWORK_ERROR, ambiguous 429) triggers a VARIABLE penalty.",
      "The level starts at 1 (or resets to 1 if the reset window has passed since the last penalty ended).",
      "Each repeat offense multiplies the cooldown by the multiplier, capped at max cooldown.",
      "Once the key stays healthy past the reset window, the next failure begins back at level 1.",
    ],
    outcome: "Persistent failures are throttled harder, but healthy periods reset the escalation.",
  },
  {
    id: "scn-predefined-limit-penalty",
    title: "Predefined Limit Penalty (RPM vs TPD)",
    summary: "The penalty duration matches the specific limit that was hit.",
    level: "intermediate",
    chart: `flowchart TD
      E["Provider error detected"] --> C["classifyError"]
      C -->|"429 + 'per minute'"| RPM["Detected: RPM"]
      C -->|"429 + 'per day / 24h'"| TPD["Detected: TPD"]
      RPM --> RP["Penalty ≈ 60s (PRE_DEFINED RPM)"]
      TPD --> TP["Penalty ≈ 24h (PRE_DEFINED TPD)"]
      RP --> A["key PENALIZED"]
      TP --> A`,
    walkthrough: [
      "`detectLimitFromError` scans the provider message/code for limit clues (RPM, TPM, RPD, TPD).",
      "If a specific limit is found, a PRE_DEFINED penalty is used with a duration matched to the limit's window.",
      "An RPM/TPM hit cools down in ~1-2 minutes; an RPD/TPD hit cools down for a full day.",
      "This avoids the waste of 'a 10-minute penalty on a daily-limit hit'.",
    ],
    outcome: "The cooldown aligns with the real-world window of the limit, so keys recover when they actually can.",
  },
  {
    id: "scn-sticky-cache",
    title: "Cache-Aware Stickiness — Stay on the Same Key",
    summary: "The selector keeps a conversation on its current key to preserve the prompt cache discount.",
    level: "intermediate",
    chart: `flowchart TD
      A["Long chat on Key A<br/>cached prefix ~50k tokens"] --> B["Next request arrives"]
      B --> C{"Is Key A still fitting<br/>& under sticky budget?"}
      C -->|"Yes"| D["STRONG STICKY BONUS<br/>prefer Key A (cache ×0.1)"]
      C -->|"No (over budget / would trip limit)"| E["Rotation cost assessed<br/>lost = cachedTokens × discount"]
      D --> F["Serve on Key A — cache preserved"]
      E --> G["May switch to Key B"]`,
    walkthrough: [
      "The `cacheDiscountFactor` (default 0.1) is the price fraction of cached tokens for that provider.",
      "`cachedPrefixLoss` computes how many prompt tokens would be re-sent uncached if the key rotated.",
      "The selector adds a strong sticky bonus for the current conversation key, so it prefers staying put.",
      "Only when a real limit or context overflow forces it does rotation happen — at the cost of the lost discount.",
    ],
    outcome: "Cached prefixes are preserved, lowering cost and latency on long conversations.",
  },
  {
    id: "scn-exhaustability",
    title: "Exhaustability Priority — Burn Keys in Order",
    summary: "The router prefers keys closest to their limit, so it exhausts them in order.",
    level: "advanced",
    chart: `flowchart LR
      subgraph Keys["Pool keys with utilization"]
        K1["Key A<br/>RPM 80% used"]
        K2["Key B<br/>RPM 40% used"]
        K3["Key C<br/>TPD 90% used"]
      end
      K1 --> S["Selector ranks by utilization:<br/>C (90%) > A (80%) > B (40%)"]
      S --> OUT["Send traffic to the most-exhausted key first"]`,
    walkthrough: [
      "Budget utilization is the max of rpm/rpmLimit, tpm/tpmLimit, rpd/rpdLimit, tpd/tpdLimit, context/window.",
      "The exhaustability weight prefers keys closest to a limit so the router burns them down predictably.",
      "It only 'jumps' to a bigger key when a large request needs a larger context window.",
      "This keeps smaller keys from sitting idle and spreads load deterministically.",
    ],
    outcome: "Keys are consumed in utilization order, making rate-limit usage predictable.",
  },
  {
    id: "scn-context-fit",
    title: "Context-Fit Selection",
    summary: "Small requests go to the smallest fitting context window, so big-context keys are preserved.",
    level: "advanced",
    chart: `flowchart TD
      A["Small prompt (2k tokens)"] --> B["Compare fitting keys:<br/>Big (128k) vs Small (16k)"]
      B --> C["Score contextFit = (1 - window/largest)×weight<br/>Small wins"]
      C --> D["Route to smallest fitting key"]
      E["Huge prompt (100k)"] --> F["Only Big (128k) fits"]
      F --> G["Route to Big key (max remaining budget)"]`,
    walkthrough: [
      "Context-fit scoring favors the smallest window that can hold the request.",
      "For a small prompt, this avoids wasting the large-context (often more expensive) key.",
      "For a huge prompt, only keys whose context window fits remain eligible.",
      "This is combined with exhaustability and stickiness in a single weighted score.",
    ],
    outcome: "Efficient context utilization across heterogeneous keys.",
  },
  {
    id: "scn-tool-calls-forwarding",
    title: "Tool-Call Loop — Assistant tool_calls Preserved",
    summary: "The router keeps assistant tool_calls intact so Copilot's agent loop doesn't re-issue tools.",
    level: "advanced",
    chart: `sequenceDiagram
      participant Client
      participant Gateway
      participant Orch as Orchestrator
      participant Provider
      Client->>Gateway: POST (tools defined, assistant.tool_calls in history)
      Gateway->>Orch: build canonical request (tool_calls forward)
      Orch->>Provider: forward tools + full conversation
      Provider-->>Orch: assistant message (content:null, tool_calls)
      Alt Model flagged reliableToolCalling=false
        Orch->>Orch: strip tools BEFORE request (empty-completion fix)
      end
      Orch-->>Client: response preserves tool_calls
      Note over Client: agent loop sees tool results → continues correctly`,
    walkthrough: [
      "Clients like Copilot send back assistant `tool_calls` so the next turn stays anchored to prior `tool` results.",
      "Dropping them detaches the tool result from its call, causing the model to re-issue tools forever.",
      "For models flagged `reliableToolCalling: false`, tools are stripped before the request to avoid empty completions.",
      "The response preserves `tool_calls` (and reasoning) so the client continues the loop correctly.",
    ],
    outcome: "Tool use works correctly; no infinite 'todo tool loop.'",
  },
  {
    id: "scn-reasoning-passthrough",
    title: "Reasoning Passthrough — Collapsible Thinking",
    summary: "Reasoning content is passed through so Copilot renders the collapsible Thinking UI.",
    level: "intermediate",
    chart: `sequenceDiagram
      participant Client
      participant Gateway
      participant Provider
      Client->>Gateway: POST chat/completions
      Gateway->>Provider: forward request
      Provider-->>Gateway: response with reasoning / reasoning_content
      Gateway->>Gateway: normalize + serialize (keep reasoning fields)
      Gateway-->>Client: message.reasoning + reason_content preserved
      Note over Client: Copilot renders collapsible Thinking block`,
    walkthrough: [
      "Some providers return reasoning fields alongside content.",
      "The canonical type and serializers carry `reasoning` and `reasoning_content` through.",
      "The streaming path also emits reasoning deltas, so the Thinking UI updates live.",
      "This keeps the human-facing UX informative while the model works.",
    ],
    outcome: "Reasoning is visible to the user in a collapsible panel, not stripped.",
  },
  {
    id: "scn-auto-calibration",
    title: "Auto-Calibration — Scale Limits to a Sustainable Ceiling",
    summary: "Limits ramp up on success and shrink on throttle, capped by a hard max.",
    level: "advanced",
    chart: `flowchart TD
      A["Key enabled with auto-calibration"] --> B["Baseline seeded from current limits"]
      B --> C["Success streak advances"]
      C --> D["Probe limits up toward baseline (×1.1, floor applied)"]
      D -->|"RATE_LIMITED"| E["Scale limits down / apply penalty"]
      E --> C
      D -->|"Success"| F["Continue advancing to hard cap<br/>maxRpm/maxTpm... never exceeded"]
      F --> C`,
    walkthrough: [
      "On each success the auto-calibrator advances a streak and cautiously probes limits upward.",
      "A throttle (RATE_LIMITED) scales limits back down so the key stops tripping penalties.",
      "Absolute max limits (maxRpmLimit, maxTpmLimit, …) act as a hard cap the calibrator never exceeds.",
      "This finds the true sustainable ceiling automatically without manual tuning.",
    ],
    outcome: "Keys self-tune to their real sustainable throughput.",
  },
  {
    id: "scn-manual-penalty",
    title: "Manual Penalty From the Admin UI",
    summary: "An operator can force a penalty by level or with a custom timer.",
    level: "intermediate",
    chart: `flowchart TD
      A["Operator clicks 'Penalty' on a key"] --> B["Open ManualPenaltyDialog"]
      B --> C{"Choose mode"}
      C -->|"By Level"| D["Pick level 1-5<br/>cooldown = base × mult^(level-1) capped"]
      C -->|"Custom Timer"| E["Enter seconds (clamped ≥10)"]
      D --> F["PATCH /api/admin/keys/[id] action=apply-penalty"]
      E --> F
      F --> G["applyManualPenalty → status PENALIZED, penaltyExpiresAt set"]
      G --> H["Key excluded from routing until expiry"]`,
    walkthrough: [
      "The Penalty button opens a modal with two modes: level-based or a custom cooldown.",
      "The level path derives cooldown from the engine's backoff (base × multiplier^(level-1)), capped at max.",
      "The custom path accepts any seconds and clamps the minimum so the penalty is never instant.",
      "The key is immediately marked PENALIZED and excluded until `penaltyExpiresAt`.",
    ],
    outcome: "Operators can take a key out of rotation immediately, with a predictable recovery time.",
  },
  {
    id: "scn-manual-reset",
    title: "Manual Penalty Reset",
    summary: "A penalized or suspended key can be brought back to ACTIVE manually.",
    level: "basic",
    chart: `flowchart TD
      A["Key PENALIZED or SUSPENDED"] --> B["Operator clicks 'Reset' (or Reactivate)"]
      B --> C["PATCH action=reset-penalty OR reactivate"]
      C --> D["status=ACTIVE, penaltyLevel=0, expiry=null"]
      D --> E["Key routable again immediately"]`,
    walkthrough: [
      "Reset clears the penalty state: status ACTIVE, penaltyLevel 0, penaltyExpiresAt null.",
      "Reactivate also clears the suspended reason and counters so a suspended key returns to service.",
      "This is the human escape hatch when automatic cooldowns are too conservative or wrong.",
    ],
    outcome: "The key returns to rotation immediately after operator action.",
  },
  {
    id: "scn-copilot-injection",
    title: "Copilot askQuestion Injection on Rotation",
    summary: "When a key rotates mid-conversation, the router injects guidance asking the user to switch or compact.",
    level: "advanced",
    chart: `sequenceDiagram
      participant Client as Copilot
      participant Gateway
      participant Orch as Orchestrator
      participant Conv as Conversation State
      Client->>Gateway: next turn (same pool)
      Gateway->>Conv: takePendingInjection(poolId)
      alt Injection pending (rotated away from prev key)
        Gateway->>Gateway: prepend system message: ask user switch vs compact
      end
      Gateway->>Orch: orchestrate (new key, context uncached)
      Orch-->>Client: response
      Note over Client: model sees guidance → calls askQuestion`,
    walkthrough: [
      "When a previous request rotated to a new key, the cached prefix is lost for that conversation.",
      "The orchestrator calls `setPendingInjection`; the next request consumes it via `takePendingInjection`.",
      "The gateway prepends a system instruction that nudges the model to ask the user whether to switch directly or compact.",
      "This surfaces a human choice through Copilot's `askQuestion` tool instead of silently degrading.",
    ],
    outcome: "Users are informed when context is uncached and can choose to switch or compact.",
  },
  {
    id: "scn-round-robin",
    title: "Round-Robin / Priority Strategies",
    summary: "Simple deterministic ordering for pools that don't need cache-awareness.",
    level: "basic",
    chart: `flowchart TD
      A["Pool routingStrategy"] --> B{"Which strategy?"}
      B -->|"ROUND_ROBIN"| RR["Order keys cyclically:<br/>A → B → C → A → B → C"]
      B -->|"PRIORITY"| PR["Order by member priority<br/>(0 highest)"]
      B -->|"KEY_AWARE"| KA["Cache-aware selector scoring"]
      RR --> OUT["Serve in order"]
      PR --> OUT
      KA --> OUT`,
    walkthrough: [
      "ROUND_ROBIN cycles through the pool's keys deterministically.",
      "PRIORITY orders by member priority, preferring the lowest-numbered first.",
      "KEY_AWARE uses the full scoring pipeline (sticky, exhaustability, context-fit, rotation cost).",
      "Simple strategies bypass the selector for lighter-weight routing.",
    ],
    outcome: "Predictable load distribution for non-cache-sensitive pools.",
  },
  {
    id: "scn-empty-completion-fix",
    title: "Empty-Completion Fix for Models That Drop Tools",
    summary: "Some free reasoning models return empty output when given a `tools` array; tools are stripped proactively.",
    level: "advanced",
    chart: `flowchart TD
      A["ProviderModel flagged reliableToolCalling=false"] --> B["Request contains tools"]
      B --> C["withoutTools(request): strip tools + tool_choice"]
      C --> D["Build request without tools"]
      D --> E["Provider returns real output (no empty completion)"]
      E --> F["Client gets valid response"]
      G["If tools were NOT stripped"] --> H["Provider returns complete-but-EMPTY turn<br/>(no content, no tool_calls, HTTP 200)"]
      H --> I["Client reports 'no response returned'"]`,
    walkthrough: [
      "Certain models (e.g. OpenRouter's stealth/ox-alpha) promise function calling but return an empty turn when `tools` is an array.",
      "The `reliableToolCalling` flag on a ProviderModel marks these; the orchestrator strips tools before building the request.",
      "This is proactive — it avoids a wasted round-trip that would otherwise produce no usable output.",
      "The streaming path also injects a terminal `finish_reason: stop` chunk so the stream is always well-formed.",
    ],
    outcome: "These models produce real output on the first attempt instead of empty completions.",
  },
  {
    id: "scn-discovery-onboarding",
    title: "Discovery Onboarding Pipeline",
    summary: "Providers are discovered, approved, keyed, and configured in stages.",
    level: "basic",
    chart: `stateDiagram-v2
      [*] --> RAW
      RAW -->|"approve"| APPROVED
      APPROVED -->|"add provider-level API keys"| APPROVED
      APPROVED -->|"configure models (+ optional baseUrl)"| CONFIGURED
      CONFIGURED -->|"add/remove keys & models"| CONFIGURED
      RAW -->|"reject"| REJECTED
      REJECTED -->|"reactivate"| RAW`,
    walkthrough: [
      "The Hermes agent discovers providers and stages them as RAW.",
      "Approving a RAW draft creates a real Provider and moves it to APPROVED.",
      "The user adds one or more provider-level API keys (shared across pools via PoolApiKey).",
      "Configuring materializes ProviderModel rows and moves the draft to CONFIGURED.",
    ],
    outcome: "Providers are onboarded with correct base URLs, models, and shared keys.",
  },
];
