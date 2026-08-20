// ─── Playground shared types ───────────────────────────
// Pure, serializable types shared by the caching-aware selector,
// budget accounting, penalty mapping, mock provider, scenario engine
// and the Copilot injection builder.

export type KeyStatus = "ACTIVE" | "PENALIZED" | "SUSPENDED" | "DISABLED";

export type LimitName = "RPM" | "TPM" | "RPD" | "TPD" | "CONTEXT";

/** A simulated provider API key owned by a pool (see design doc §2.2). */
export interface SimKey {
  id: string;
  label: string;
  provider: string;
  // rate / token limits (null = unlimited)
  rpmLimit: number | null;
  tpmLimit: number | null;
  rpdLimit: number | null;
  tpdLimit: number | null;
  // performance characteristics
  tps: number | null; // tokens per second (speed)
  timeToFirstTokenMs: number; // lower = faster
  contextWindow: number; // max context tokens
  // prompt-caching
  cacheCapable: boolean;
  cacheDiscountFactor: number; // 0..1 (cached-token price fraction)
  // health / lifecycle
  status: KeyStatus;
  penaltyLevel: number;
  penaltyExpiresAt: number | null; // epoch ms
}

/** A single inbound gateway request we must route. */
export interface RequestSpec {
  promptTokens: number; // input tokens (from client or estimated)
  completionBudget: number; // predicted output tokens to reserve for context fit
}

/** Sticky-context tracking for the current conversation. */
export interface ConversationCtx {
  currentKeyId: string | null;
  lastPromptTokens: number; // size of the previous prompt on the current key
}

/** Rolling-window usage for one key (see budget.ts). */
export interface KeyUsage {
  rpm: number[]; // request timestamps (60s)
  tpm: { ts: number; tokens: number }[]; // 60s
  rpd: { ts: number }[]; // 24h
  tpd: { ts: number; tokens: number }[]; // 24h
  lastUsedAt: number | null;
  totalTokensServed: number;
  cachedTokensSaved: number; // cumulative discount accrued
}

export interface LimitState {
  limit: LimitName;
  used: number;
  ceiling: number; // null-limit → Infinity
  remaining: number;
  utilization: number; // used/ceiling, 0 when unlimited
}

/** Scored candidate emitted by the selector. */
export interface RankedCandidate {
  key: SimKey;
  score: number;
  utilization: number; // max utilization across limits
  fits: boolean;
  reasons: string[];
}

/** A single decision the selector made. */
export interface SelectResult {
  chosenKeyId: string | null;
  candidates: RankedCandidate[]; // sorted, best first
  reason: string;
  stickyUsed: boolean;
  rotationLostCacheTokens: number; // tokens that become uncached if we switch away
  events: SelectEvent[];
}

export type SelectEvent =
  | { kind: "filter"; keyId: string; reason: string }
  | { kind: "fit"; keyId: string; needed: number; window: number }
  | { kind: "sticky"; keyId: string; cachedTokens: number }
  | { kind: "rank"; keyId: string; score: number; utilization: number };

/** Penalty applied when a key hits a limit. */
export interface PenaltyInfo {
  keyId: string;
  limit: LimitName;
  penaltySeconds: number;
  penaltyLevel: number;
  expiresAt: number; // epoch ms
}

/** Result of simulating one request against one key. */
export type MockOutcome =
  | { ok: true; tokensUsed: number; cachedTokens: number }
  | { ok: false; limit: LimitName; detail: string };

/** One step of a scripted scenario. */
export interface ScenarioStep {
  id: number;
  request: RequestSpec;
  injectError: LimitName | null; // mechanically force this limit to fire
}

/** A full trace entry for the playground UI. */
export interface TraceEvent {
  step: number;
  kind: "route" | "penalty" | "injection" | "note";
  message: string;
  detail?: string;
}
