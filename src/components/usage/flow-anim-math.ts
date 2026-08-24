// ─── Flow Animation Math (pure) ────────────────────────
// Deterministic, request-id-derived animation parameters so dots don't jump
// on each 1s poll. A hash of the requestId gives a stable phase/offset, and we
// use a virtual "progress clock" from the start time so a dot travels smoothly
// along its path regardless of polling cadence.

export interface PathSegment {
  from: { x: number; y: number };
  to: { x: number; y: number };
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Stable 0..1 hash from a string id (multiplied by factor). */
export function hashPhase(id: string, factor = 0.37): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h % 1000) / 1000 * factor;
}

/**
 * Position of a dot along a path at virtual "time" (in seconds, monotonic).
 * A request dot leaves the origin, travels to the destination, then wraps
 * (returns to origin) so it loops continuously while the request is active.
 */
export function dotAlongPath(seg: PathSegment, phase: number, time: number, duration = 2.4): { x: number; y: number; t: number } {
  const t = (time * 1 + phase) % duration;
  const progress = t / duration;
  return {
    x: lerp(seg.from.x, seg.to.x, progress),
    y: lerp(seg.from.y, seg.to.y, progress),
    t: progress,
  };
}

/**
 * A response token particle travels the FULL return path (key → gateway →
 * client) as a short-lived particle. Progress `p` in 0..1; we split into two
 * legs: key→gateway (0..0.72) then gateway→client (0.72..1).
 */
export function tokenParticlePosition(
  key: { x: number; y: number },
  gatewayOut: { x: number; y: number },
  gatewayIn: { x: number; y: number },
  client: { x: number; y: number },
  progress: number
): { x: number; y: number } {
  const leg = progress < 0.72 ? Math.min(1, progress / 0.72) : (progress - 0.72) / 0.28;
  if (progress < 0.72) {
    // key → gateway right edge (reverse of the request path).
    return { x: lerp(key.x, gatewayOut.x, leg), y: lerp(key.y, gatewayOut.y, leg) };
  }
  // through the gateway → client
  return { x: lerp(gatewayIn.x, client.x, leg), y: lerp(gatewayIn.y, client.y, leg) };
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
