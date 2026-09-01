# Document 09 — Context Compaction Plan

> **Purpose**: Gateway-level context compaction for Copilot. The model becomes context-aware and can REQUEST compaction at any safe point, reducing input tokens and cost.  
> **Status**: Approved — ready for implementation — ready for implementation — ready for implementation  
> **Last Updated**: 2026-08-25

---

## 1. Problem Statement

When Copilot sends requests through the LLM Router, the full conversation history is included in every request. As the conversation grows, input tokens increase — and so does cost (input pricing, cached pricing). Copilot has its own auto-compaction at ~80% context capacity, but:

1. **The model has no awareness** of its context usage (no "I'm at 50%" signal)
2. **The model can't choose** when to compact — it's purely client-budget-driven
3. **Compaction only happens near overflow** — not at optimal cost-saving points
4. **No tool exists** for the model to request compaction (GitHub Copilot CLI issue #3916 is open)

## 2. Goal

Build a **gateway-level context compaction** feature that:

- Makes the model **context-aware** (knows its token usage and context window)
- Gives the model a **`compact_context` tool** it can call at any safe point
- Performs **server-side summarization** when the tool is called
- **Reduces input tokens** on subsequent requests by replacing old messages with a summary
- Does **not conflict** with Copilot's built-in auto-compaction or `/context` indicators

## 3. Key Insight

> Compaction is not just about avoiding overflow. It's about **cost optimization**.
>
> A compacted summary of 50 messages might be 2,000 tokens. The original 50 messages
> might be 40,000 tokens. Compacting at 30% usage saves 38,000 input tokens on every
> subsequent request — significant cost savings at scale.

The model is the best judge of **when** a conversation has reached a natural boundary (task complete, phase transition, safe to summarize). Let it decide.

## 4. Architecture

### 4.1 Request Flow (No Compaction)

```
Copilot → Gateway → Provider
           │
           ├─ [1] Receive full messages array
           ├─ [2] Estimate token usage
           ├─ [3] Inject context awareness into system prompt
           ├─ [4] Inject compact_context tool into tools array
           ├─ [5] Forward to provider
           └─ [6] Return response to Copilot
```

### 4.2 Request Flow (With Compaction)

```
Request N (model calls compact_context):
  Copilot → Gateway
    [1] Receive full messages array
    [2] Estimate token usage → inject "[CONTEXT] 35% used (45k/128k)"
    [3] Inject compact_context tool
    [4] Forward to provider
    [5] Model calls compact_context (at safe point)
    [6] Gateway INTERCEPTS — never sends tool call to provider
    [7] Gateway calls LLM to summarize first N messages
    [8] Gateway stores summary in session state
    [9] Gateway returns: "Context compacted. Summary stored for next request."

Request N+1 (same conversation):
  Copilot → Gateway (still sends full history)
    [1] Detect stored summary for this conversation
    [2] Replace old messages with summary: [summary_system_msg, last_5_messages]
    [3] Inject updated context awareness: "[CONTEXT] 8% used (10k/128k)"
    [4] Forward COMPACTED array to provider
    [5] Model sees: summary + recent messages = fresh context, low cost
```

### 4.3 Conversation Fingerprinting

The gateway needs to know when two requests belong to the same conversation. Since the client (Copilot) doesn't send a session ID, the gateway uses a **fingerprint** derived from the conversation:

- Hash the **first 3 messages** (system + first user + first assistant) to create a conversation ID
- Store summaries keyed by this fingerprint
- TTL: 24 hours (auto-expire stale sessions)

This is stateless from the client's perspective — no headers, no session tokens.

## 5. Module Design

### 5.1 Context Awareness Injection (`src/engine/routing/context-awareness.ts`)

**Purpose**: Adds context usage info to the system prompt so the model knows its budget.

```typescript
// Injects a [CONTEXT] block into the system message:
// [CONTEXT] Window: 128,000 tokens | Used: ~45,000 (35%) | Compaction: available [/CONTEXT]
export function injectContextAwareness(
  messages: CanonicalMessage[],
  contextWindow: number,       // from ProviderModel.contextWindow or default
  toolTokens?: number          // estimated tokens consumed by tool definitions
): CanonicalMessage[]
```

**Design decisions**:
- Injected into the **system message** (or prepended as a new system message if none exists)
- Uses `~` prefix for estimates (we don't have exact token counts from the client)
- The model sees this on EVERY request, keeping it continuously aware
- Does NOT modify the user's actual system prompt — adds a separate invisible block

### 5.2 Compact Context Tool (`src/engine/routing/compact-context.ts`)

**Purpose**: Defines the `compact_context` tool and handles the compaction flow.

```typescript
// Tool definition injected into the tools array
export const COMPACT_CONTEXT_TOOL = {
  type: "function",
  function: {
    name: "compact_context",
    description: "Request context compaction. Call this when you've completed a task "
      + "or reached a natural conversation boundary and want to reduce context size "
      + "for cost savings. The gateway will summarize the conversation and replace "
      + "old messages with the summary on the next request.",
    parameters: {
      type: "object",
      properties: {
        focus_areas: {
          type: "array",
          items: { type: "string" },
          description: "Key topics to preserve in the summary (e.g., ['file changes', 'decisions made', 'current task'])"
        }
      }
    }
  }
}

// Intercept tool call and perform compaction
export async function handleCompactionRequest(
  messages: CanonicalMessage[],
  toolCall: CanonicalToolCall,
  contextWindow: number
): Promise<{ summary: string; compactedMessages: CanonicalMessage[] }>
```

**The tool call flow**:
1. Model calls `compact_context({ focus_areas: ["file changes", "architecture decisions"] })`
2. Gateway intercepts — never forwards to provider
3. Gateway sends messages to an LLM with a summarization prompt
4. Summary is stored keyed by conversation fingerprint
5. Gateway returns a tool result to the model: "Context compaction requested. Summary stored."

### 5.3 Conversation Session Store (`src/engine/routing/compaction-store.ts`)

**Purpose**: Stores compaction summaries keyed by conversation fingerprint.

```typescript
export interface CompactionEntry {
  fingerprint: string
  summary: string
  createdAt: number          // epoch ms
  originalTokenEstimate: number
  summaryTokenEstimate: number
}

// In-memory store with 24h TTL
export function storeCompaction(entry: CompactionEntry): void
export function getCompaction(fingerprint: string): CompactionEntry | null
export function clearCompaction(fingerprint: string): void
```

**Design decisions**:
- In-memory `Map` (matches existing penalty-window pattern)
- 24h TTL auto-expiry
- No DB table needed (transient, session-scoped)

### 5.4 Message Compactor (`src/engine/routing/message-compactor.ts`)

**Purpose**: Replaces old messages with a summary on subsequent requests.

```typescript
// Given a stored summary and a full messages array, produce a compacted version:
// [summary_system_message, last N messages (preserving recency)]
export function applyCompaction(
  messages: CanonicalMessage[],
  summary: string,
  preserveLastN?: number      // default 5 (last 5 messages kept verbatim)
): CanonicalMessage[]
```

**Design decisions**:
- Keep the **last 5 messages** verbatim (recent context is most relevant)
- Replace everything before that with a single system message containing the summary
- The summary includes: conversation overview, key decisions, file changes, current state, next steps
- The `[CONTEXT]` awareness block is re-injected after compaction (shows reduced usage)

### 5.5 Gateway Integration (`src/app/api/gateway/v1/chat/completions/route.ts`)

**Purpose**: Wire everything into the existing gateway route.

**Integration points**:
1. After parsing the request, before forwarding to the orchestrator:
   - Estimate token usage from `messages`
   - Call `injectContextAwareness(messages, contextWindow)`
   - Check for stored compaction → call `applyCompaction(messages, summary)`
   - Add `COMPACT_CONTEXT_TOOL` to the `tools` array

2. After receiving the response from the orchestrator:
   - Check if the model called `compact_context`
   - If yes: intercept, call `handleCompactionRequest()`, return compaction response
   - If no: forward response normally

3. Compute conversation fingerprint from the first 3 messages

### 5.6 Token Estimation (`src/engine/rate-limit/token-estimator.ts` — extend)

**Purpose**: Estimate tokens in the messages array for context awareness.

Already exists with `estimateTokens(messages)`. Extend to:
- Return breakdown: `{ system, messages, tools, total }`
- Support estimating a subset of messages (for "used vs. remaining" display)

## 6. Configuration

| Env Var | Default | Description |
|---|---|---|
| `COMPACT_CONTEXT_ENABLED` | `true` | Enable/disable the feature entirely |
| `COMPACT_THRESHOLD_WARNING` | `30` | Inject `[CONTEXT]` warning when usage exceeds this % |
| `COMPACT_PRESERVE_LAST_N` | `5` | Number of recent messages to keep verbatim after compaction |
| `COMPACT_SESSION_TTL_HOURS` | `24` | How long to store compaction summaries |

**Docker compose** additions:
```yaml
- COMPACT_CONTEXT_ENABLED=${COMPACT_CONTEXT_ENABLED:-true}
- COMPACT_THRESHOLD_WARNING=${COMPACT_THRESHOLD_WARNING:-30}
- COMPACT_PRESERVE_LAST_N=${COMPACT_PRESERVE_LAST_N:-5}
- COMPACT_SESSION_TTL_HOURS=${COMPACT_SESSION_TTL_HOURS:-24}
```

## 7. Interaction with Copilot's Built-in Compaction

| Aspect | Copilot Auto-Compaction | Our Gateway Compaction |
|---|---|---|
| **Trigger** | Client budget check at ~80% | Model calls `compact_context` tool |
| **When** | Near overflow | Any time (model's choice) |
| **Who summarizes** | Copilot sends to model | Gateway sends to model |
| **What gets summarized** | Full conversation | First N messages (recent kept) |
| **Client awareness** | Copilot handles it | Gateway intercepts tool call |
| **Conflict** | Independent | **No conflict** — different mechanisms |

**They complement each other**:
- Our compaction happens at the **gateway level** (before Copilot's budget check)
- If the model compacts early (e.g., at 30%), Copilot never reaches 80% → auto-compaction never fires
- If the model doesn't compact, Copilot's auto-compaction still works as a safety net
- The `[CONTEXT]` awareness block helps the model make better decisions

## 8. What the Model Sees

### Before compaction (35% usage):
```
[CONTEXT] Window: 128,000 tokens | Used: ~45,000 (35%) | Compaction: available [/CONTEXT]

[System: You are a helpful coding assistant...]
[User: Help me implement feature X]
[Assistant: I'll implement feature X... (long response with file edits)]
[User: Now add tests]
[Assistant: I'll add tests... (another long response)]
...
```

### Model calls `compact_context`:
```
Tool call: compact_context({ focus_areas: ["feature X implementation", "test structure"] })
```

### Gateway returns tool result:
```
Tool result: "Context compaction requested. Summary stored for next request. 
Continue with the current task."
```

### Next request (compacted):
```
[CONTEXT] Window: 128,000 tokens | Used: ~12,000 (9%) | Compaction: applied [/CONTEXT]

[System: Conversation summary: User requested feature X implementation. 
Key decisions: [list]. Files changed: [list]. Current state: [state]. 
Next steps: [steps].]

[User: Now add tests]
[Assistant: I'll add tests... (response with fresh context)]
```

## 9. Edge Cases

| Case | Handling |
|---|---|
| **Model calls compact_context mid-task** | Gateway stores summary but model continues current response. Next request uses summary. |
| **Compaction during streaming** | Not supported — compaction only on non-streaming requests or after stream completes |
| **No context window configured** | Use default 128k. `[CONTEXT]` still injected with estimate. |
| **Multiple rapid compactions** | Summary is overwritten each time (latest wins). TTL resets. |
| **Provider error after compaction** | Summary is still stored. Next request uses it regardless of provider outcome. |
| **Conversation fingerprint collision** | Extremely unlikely (SHA-256 of first 3 messages). If it happens, summary is for the wrong conversation — harmless (model ignores irrelevant summary). |

## 10. Implementation Steps

| Step | Module | Effort |
|---|---|---|
| 1 | `context-awareness.ts` — inject `[CONTEXT]` block | Small |
| 2 | `compact-context.ts` — tool definition + intercept | Medium |
| 3 | `compaction-store.ts` — in-memory session store | Small |
| 4 | `message-compactor.ts` — replace old messages with summary | Small |
| 5 | `token-estimator.ts` — extend with breakdown | Small |
| 6 | Gateway route integration — wire all modules | Medium |
| 7 | Env vars + docker-compose + `.env.example` | Small |
| 8 | `scripts/verify-compaction.ts` — regression test | Medium |
| 9 | Docs `09-context-compaction-plan.md` → mark implemented | Small |

## 11. Cost Analysis

| Scenario | Without Compaction | With Compaction |
|---|---|---|
| 50-message conversation | ~40k input tokens per request | ~2k summary + 5 recent = ~5k per request |
| Cost per request (at $3/1M input) | $0.12 | $0.015 |
| **Savings** | — | **87.5%** |

The compaction itself costs one extra LLM call (summarization), but this is a one-time cost per compaction that pays for itself within 2-3 subsequent requests.

## 12. Future Enhancements

- **Streaming compaction**: Compaction during active streams (not just between requests)
- **Multi-level summaries**: Summary of summaries for very long conversations
- **Compaction analytics**: Track compaction frequency, token savings, cost reduction
- **User-facing indicator**: Show "Context compacted" in the chat UI when compaction occurs
- **Configurable preservation**: Let the model specify how many recent messages to keep (via tool arguments)
