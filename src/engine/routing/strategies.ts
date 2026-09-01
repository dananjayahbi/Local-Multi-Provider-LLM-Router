// ─── Routing Strategy Ordering ─────────────────────────
// Pure ordering helpers that turn a pool's `routingStrategy` into an actual
// candidate order. The caching-aware KEY_AWARE path lives in selector.ts
// (it needs conversation affinity + live rate-limiter usage); ROUND_ROBIN and
// PRIORITY are simple deterministic orderings handled here.
//
//   ROUND_ROBIN — least-recently-used key first (spreads load evenly).
//   PRIORITY    — member priority first (lower = tried first), then LRU.
//   KEY_AWARE   — handled by the caching-aware selector (see orchestrator).

import { RouteCandidate } from "./selector";

export type RoutingStrategy = "ROUND_ROBIN" | "PRIORITY" | "KEY_AWARE";

/** A candidate key paired with its member's priority (for PRIORITY ordering). */
export interface StrategyCandidate {
  key: RouteCandidate;
  memberPriority: number;
}

/** True when the strategy is handled by this module (not the caching selector). */
export function isSimpleStrategy(strategy: string): boolean {
  return strategy === "ROUND_ROBIN" || strategy === "PRIORITY";
}

/** Milliseconds since epoch for LRU ordering; never-used keys sort first. */
function lastUsedMs(key: RouteCandidate): number {
  return key.lastUsedAt ? key.lastUsedAt.getTime() : 0;
}

/**
 * Order candidates for ROUND_ROBIN / PRIORITY. Returns a new array; the
 * input is not mutated. For PRIORITY, ties within the same member priority
 * are broken by least-recently-used so load still spreads across keys.
 */
export function orderByStrategy(
  candidates: StrategyCandidate[],
  strategy: RoutingStrategy
): StrategyCandidate[] {
  const arr = [...candidates];
  if (strategy === "PRIORITY") {
    arr.sort((a, b) => {
      if (a.memberPriority !== b.memberPriority) {
        return a.memberPriority - b.memberPriority;
      }
      return lastUsedMs(a.key) - lastUsedMs(b.key);
    });
  } else {
    // ROUND_ROBIN (and any unknown value) — least-recently-used first.
    arr.sort((a, b) => lastUsedMs(a.key) - lastUsedMs(b.key));
  }
  return arr;
}
