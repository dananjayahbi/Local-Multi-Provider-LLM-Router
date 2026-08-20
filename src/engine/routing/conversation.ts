// ─── Per-Pool Conversation Affinity ────────────────────
// In-memory tracking of the "current key" + last prompt size per pool,
// so the caching-aware selector can keep a long chat on the same key
// (preserving provider prompt-cache discount). Keyed by pool id.

interface ConversationState {
  currentKeyId: string | null;
  lastPromptTokens: number;
  lastRequestAt: number;
}

const stateByPool = new Map<string, ConversationState>();

export function getConversationState(poolId: string): ConversationState {
  const existing = stateByPool.get(poolId);
  if (existing) return existing;
  const fresh: ConversationState = { currentKeyId: null, lastPromptTokens: 0, lastRequestAt: 0 };
  stateByPool.set(poolId, fresh);
  return fresh;
}

/** Update affinity after a successful request on `keyId`. */
export function setConversationKey(
  poolId: string,
  keyId: string,
  promptTokens: number
): void {
  const st = getConversationState(poolId);
  st.currentKeyId = keyId;
  st.lastPromptTokens = promptTokens;
  st.lastRequestAt = Date.now();
}

/** Reset affinity (e.g. after all keys fail, force fresh selection). */
export function clearConversationKey(poolId: string): void {
  const st = getConversationState(poolId);
  st.currentKeyId = null;
  st.lastPromptTokens = 0;
}

/** Pending Copilot injection to attach to the NEXT request for this pool. */
export interface PendingInjection {
  keyLabel: string;
  limitName: string;
  nextKeyLabel: string | null;
  promptTokens: number;
  lastPromptTokens: number;
}

export function setPendingInjection(poolId: string, injection: PendingInjection): void {
  const st = getConversationState(poolId);
  (st as any).pendingInjection = injection;
}

export function takePendingInjection(poolId: string): PendingInjection | null {
  const st = getConversationState(poolId);
  const inj = (st as any).pendingInjection as PendingInjection | undefined;
  (st as any).pendingInjection = undefined;
  return inj ?? null;
}

/** Stale-state guard: only trust affinity within a recent window. */
const STALE_MS = 30 * 60_000; // 30 min
export function isAffinityFresh(poolId: string): boolean {
  const st = stateByPool.get(poolId);
  return !!st && Date.now() - st.lastRequestAt < STALE_MS;
}
