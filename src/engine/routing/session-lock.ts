// ─── Multi-Session Key Lock Registry ───────────────────
// In-memory registry that assigns at most ONE key per (session, pool). A
// Copilot session that is mid-conversation "holds" its key; a concurrent
// session asking the same pool is steered away from that key so the two don't
// collide (which would both break the provider's prompt-cache discount and
// exhaust a single key too fast).
//
// Lifecycle:
//   acquireSessionLock(sessionId, poolId, candidates) → the caller's key
//   getSessionLockedKey(sessionId, poolId)              → currently held key
//   releaseSessionLock(sessionId, poolId, keyId?)       → explicit release
//   releaseSessionLockForKey(poolId, keyId)             → penalty-driven release
//   isKeyLockedByOtherSession(sessionId, poolId, keyId) → exclusion check
//
// A lock is a soft pin: it does NOT guarantee the key stays healthy. If the
// key is penalized it is released immediately. Stale locks (a session that
// went away) are swept after SESSION_LOCK_TTL_MS.
//
// NOTE: This is per-process memory (like the conversation-affinity + rate-limit
// registries). It does not survive a container restart, which is fine — a lock
// is a live-session concern, and a reboot naturally resets all sessions.

import type { RouteCandidate } from "./selector";

export interface SessionLock {
  /** The owning session id (as resolved by resolveSessionId). */
  sessionId: string;
  poolId: string;
  keyId: string;
  keyLabel: string;
  acquiredAt: number;
  lastUsedAt: number;
  /** Accumulated successful requests on this key, for debugging. */
  requestCount: number;
}

// Composite registry key.
function lockKey(sessionId: string, poolId: string): string {
  return `${sessionId}::${poolId}`;
}

const locks = new Map<string, SessionLock>();

/** Default time a lock survives without any request touching it. */
export const DEFAULT_SESSION_LOCK_TTL_MS = 60 * 60_000; // 60 min

/** Resolve the configured TTL from env (0 disables expiry). */
export function sessionLockTtlMs(): number {
  const raw = process.env.SESSION_LOCK_TTL_MS;
  if (raw == null || raw.trim() === "") return DEFAULT_SESSION_LOCK_TTL_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
}

function sweepStale(ttlMs: number): void {
  if (ttlMs <= 0) return;
  const now = Date.now();
  for (const [key, lock] of locks) {
    if (now - lock.lastUsedAt > ttlMs) locks.delete(key);
  }
}

/** Mark a lock as used (updated lastUsedAt + requestCount). */
function touch(lock: SessionLock): void {
  lock.lastUsedAt = Date.now();
  lock.requestCount += 1;
}

/** When true, log every acquire/release decision so session→key pinning is visible. */
function debugEnabled(): boolean {
  return process.env.SESSION_ID_DEBUG === "1" || process.env.SESSION_ID_DEBUG === "true";
}

function shortSession(sessionId: string): string {
  return sessionId.length <= 12 ? sessionId : `${sessionId.slice(0, 12)}…`;
}

/**
 * Return the key currently held by `sessionId` for `poolId`, or null. Used to
 * (a) force the routing selector to keep the session on its key and (b) decide
 * whether a candidate is free.
 */
export function getSessionLockedKey(sessionId: string, poolId: string): SessionLock | null {
  sweepStale(sessionLockTtlMs());
  return locks.get(lockKey(sessionId, poolId)) ?? null;
}

/**
 * True when `keyId` is currently locked by a DIFFERENT session on this pool.
 * The orchestrator excludes such keys from another session's candidate list so
 * two concurrent sessions never share a key.
 */
export function isKeyLockedByOtherSession(
  sessionId: string,
  poolId: string,
  keyId: string
): boolean {
  sweepStale(sessionLockTtlMs());
  for (const lock of locks.values()) {
    if (lock.poolId === poolId && lock.keyId === keyId && lock.sessionId !== sessionId) {
      return true;
    }
  }
  return false;
}

/** Whether a candidate key is free for `sessionId` to take (not held by anyone). */
function isKeyFree(sessionId: string, poolId: string, keyId: string): boolean {
  // The same session re-taking its own key is always allowed.
  const held = locks.get(lockKey(sessionId, poolId));
  if (held && held.keyId === keyId) return true;
  return !isKeyLockedByOtherSession(sessionId, poolId, keyId);
}

/**
 * Acquire a lock for `sessionId` on `poolId`, choosing the BEST candidate key
 * that is not held by another session. Prefers the session's current key if it
 * is still available. Returns the lock (or null if no key in `candidates` is
 * free). `candidates` must already be ordered best-first by the selector.
 */
export function acquireSessionLock(
  sessionId: string,
  poolId: string,
  candidates: RouteCandidate[]
): SessionLock | null {
  sweepStale(sessionLockTtlMs());
  const key = lockKey(sessionId, poolId);

  // 1) If the session already holds a key that is still a candidate, keep it.
  const held = locks.get(key);
  if (held && candidates.some((c) => c.apiKeyId === held.keyId)) {
    touch(held);
    if (debugEnabled()) {
      console.error(
        `[session-lock] acquire session=${shortSession(sessionId)} pool=${poolId} → KEPT ` +
          `key=${held.keyId.slice(0, 8)} (sticky) count=${held.requestCount}`
      );
    }
    return held;
  }

  // 2) Otherwise pick the first candidate not held by another session.
  const free = candidates.find((c) => isKeyFree(sessionId, poolId, c.apiKeyId));
  if (!free) {
    if (debugEnabled()) {
      console.error(
        `[session-lock] acquire session=${shortSession(sessionId)} pool=${poolId} → NO FREE KEY ` +
          `(all locked by other sessions)`
      );
    }
    return null;
  }

  const lock: SessionLock = {
    sessionId,
    poolId,
    keyId: free.apiKeyId,
    keyLabel: free.apiKeyLabel,
    acquiredAt: Date.now(),
    lastUsedAt: Date.now(),
    requestCount: 0,
  };
  locks.set(key, lock);
  if (debugEnabled()) {
    console.error(
      `[session-lock] acquire session=${shortSession(sessionId)} pool=${poolId} → NEW ` +
        `key=${free.apiKeyId.slice(0, 8)} label=${free.apiKeyLabel}`
    );
  }
  return lock;
}

/**
 * Explicitly release a session's lock. When `keyId` is provided, only release
 * if the session still holds THAT key (so a penalty on a different key doesn't
 * clear a healthy lock). Returns true if a lock was removed.
 */
export function releaseSessionLock(
  sessionId: string,
  poolId: string,
  keyId?: string
): boolean {
  const key = lockKey(sessionId, poolId);
  const lock = locks.get(key);
  if (!lock) return false;
  if (keyId && lock.keyId !== keyId) return false;
  locks.delete(key);
  return true;
}

/**
 * Release any lock on `keyId` for `poolId` belonging to ANY session — called
 * when a key becomes PENALIZED so the next session doesn't route to a key in
 * cooldown. Returns the number of locks cleared.
 */
export function releaseSessionLockForKey(poolId: string, keyId: string): number {
  let released = 0;
  for (const [key, lock] of locks) {
    if (lock.poolId === poolId && lock.keyId === keyId) {
      locks.delete(key);
      released++;
    }
  }
  return released;
}

/** All active locks for a pool (for the /usage flow + debugging). */
export function listLocksForPool(poolId: string): SessionLock[] {
  sweepStale(sessionLockTtlMs());
  return [...locks.values()].filter((l) => l.poolId === poolId);
}

/** Total active locks (debugging). */
export function countLocks(): number {
  sweepStale(sessionLockTtlMs());
  return locks.size;
}

/**
 * Sweep stale locks and return how many were dropped. Used by the background
 * penalty-recovery loop so a session that vanished (closed chat window) doesn't
 * pin a key forever.
 */
export function countStaleLocks(): number {
  const ttl = sessionLockTtlMs();
  if (ttl <= 0) return 0;
  const now = Date.now();
  let dropped = 0;
  for (const [key, lock] of locks) {
    if (now - lock.lastUsedAt > ttl) {
      locks.delete(key);
      dropped++;
    }
  }
  return dropped;
}

/** Clear ALL locks (used by tests). */
export function clearAllLocks(): void {
  locks.clear();
}
