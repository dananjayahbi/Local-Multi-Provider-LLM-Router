// ─── Per-Session Conversation Affinity ─────────────────
// In-memory tracking of the "current key" + last prompt size per (session,
// pool), so the caching-aware selector can keep a long chat on the same key
// (preserving provider prompt-cache discount). When a sessionId is supplied
// (multi-session locking), state is scoped to that session so two concurrent
// Copilot sessions don't leak their "current key" into each other. Without a
// sessionId the legacy pool-only behavior is preserved.

interface ConversationState {
  currentKeyId: string | null;
  lastPromptTokens: number;
  lastRequestAt: number;
}

const stateByPool = new Map<string, ConversationState>();

/** Compose the registry key, scoping to a session when one is provided. */
function stateKey(poolId: string, sessionId?: string | null): string {
  return sessionId ? `${poolId}::${sessionId}` : poolId;
}

export function getConversationState(poolId: string, sessionId?: string | null): ConversationState {
  const key = stateKey(poolId, sessionId);
  const existing = stateByPool.get(key);
  if (existing) return existing;
  const fresh: ConversationState = { currentKeyId: null, lastPromptTokens: 0, lastRequestAt: 0 };
  stateByPool.set(key, fresh);
  return fresh;
}

/** Update affinity after a successful request on `keyId`. */
export function setConversationKey(
  poolId: string,
  keyId: string,
  promptTokens: number,
  sessionId?: string | null
): void {
  const st = getConversationState(poolId, sessionId);
  st.currentKeyId = keyId;
  st.lastPromptTokens = promptTokens;
  st.lastRequestAt = Date.now();
}

/** Reset affinity (e.g. after all keys fail, force fresh selection). */
export function clearConversationKey(poolId: string, sessionId?: string | null): void {
  const st = getConversationState(poolId, sessionId);
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

export function setPendingInjection(poolId: string, injection: PendingInjection, sessionId?: string | null): void {
  const st = getConversationState(poolId, sessionId);
  (st as any).pendingInjection = injection;
}

export function takePendingInjection(poolId: string, sessionId?: string | null): PendingInjection | null {
  const st = getConversationState(poolId, sessionId);
  const inj = (st as any).pendingInjection as PendingInjection | undefined;
  (st as any).pendingInjection = undefined;
  return inj ?? null;
}

/** Stale-state guard: only trust affinity within a recent window. */
const STALE_MS = 30 * 60_000; // 30 min
export function isAffinityFresh(poolId: string, sessionId?: string | null): boolean {
  const st = stateByPool.get(stateKey(poolId, sessionId));
  return !!st && Date.now() - st.lastRequestAt < STALE_MS;
}
