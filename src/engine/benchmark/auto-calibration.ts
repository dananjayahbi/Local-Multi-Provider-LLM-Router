// ─── Auto-Calibration Engine ──────────────────────────
// AIMD-style tuning: when a key has `autoCalibration` enabled, the
// orchestrator feeds real provider outcomes here. Rate-limit / throttle
// errors scale the key's limits DOWN (multiplicative decrease) to find the
// true sustainable ceiling; sustained success streaks probe cautiously UP
// (additive) toward the user's baseline ceiling so the key stays usable
// without tripping penalties over and over.
//
// State is persisted per-key in `ApiKey.autoCalibrationState` (JSON).

import { prisma } from "@/lib/prisma";
import { ErrorClassification } from "../error-classifier";
import { detectLimitFromError } from "../penalty-application";
import { LimitName } from "../playground/types";
import {
  createAutoCalibrationEvent,
} from "../data-access/auto-calibration-events";

// ─── Tuning constants ─────────────────────────────────
const DECREASE_FACTOR = 0.7; // multiply down by 30% on a throttle hit
const INCREASE_FACTOR = 1.1; // multiply up by 10% on a success streak
const SUCCESS_STREAK_THRESHOLD = 15; // consecutive successes before probing up
// Hard floors so limits never become useless.
const MIN_RPM = 1;
const MIN_TPM = 500;
const MIN_RPD = 1;
const MIN_TPD = 1000;

export interface AutoCalibrationLimits {
  rpmLimit: number | null;
  tpmLimit: number | null;
  rpdLimit: number | null;
  tpdLimit: number | null;
}

/** Per-key absolute max (hard cap). The auto-calibrator NEVER probes a limit
 *  above the matching `max*` value, even if the baseline or AIMD would allow
 *  it. null = no hard cap (unlimited). */
export interface HardCapLimits {
  maxRpmLimit: number | null;
  maxTpmLimit: number | null;
  maxRpdLimit: number | null;
  maxTpdLimit: number | null;
}

/** Per-key minimum cap (floor). The auto-calibrator NEVER scales a limit
 *  BELOW the matching `min*` value. For keys with unpatterned rate limits
 *  (provider 429s that never state a ceiling), the calibrator would otherwise
 *  shrink the limit to the built-in minimum, making the key nearly useless.
 *  null = use the built-in minimum (MIN_RPM / MIN_TPM / MIN_RPD / MIN_TPD). */
export interface MinCapLimits {
  minRpmLimit: number | null;
  minTpmLimit: number | null;
  minRpdLimit: number | null;
  minTpdLimit: number | null;
}

export interface AutoCalibrationState {
  /** The user's claimed ceiling captured when auto-calibration was enabled
   *  (or the last time it was manually reset). Never exceeded. */
  baseline: AutoCalibrationLimits;
  /** Consecutive successful requests since the last adjustment. */
  consecutiveSuccesses: number;
  /** Epoch ms of the last limit adjustment, or null if never adjusted. */
  lastAdjustmentAt: number | null;
}

const EMPTY_LIMITS: AutoCalibrationLimits = {
  rpmLimit: null,
  tpmLimit: null,
  rpdLimit: null,
  tpdLimit: null,
};

function isEmptyMap(l: AutoCalibrationLimits): boolean {
  return (
    l.rpmLimit == null &&
    l.tpmLimit == null &&
    l.rpdLimit == null &&
    l.tpdLimit == null
  );
}

// ─── First-throttle seeding ───────────────────────────
// A key that is auto-calibrated but has NO limits yet (∞/unlimited) can never
// be tuned by AIMD alone: `scaleDown(null)` is a no-op and `isEmptyMap(baseline)`
// short-circuits every success probe. The very FIRST provider throttle is the
// strongest signal we'll ever get about the key's real ceiling, so we use it
// to SEED the limits. This is what makes the calibrator "aware from the very
// beginning" — it stops hammering the provider and starts throttling locally.

// Fallback ceilings when the provider message doesn't state an explicit number.
const SEED_FALLBACKS: Record<LimitName, number> = {
  RPM: 30,
  TPM: 60_000,
  RPD: 300,
  TPD: 300_000,
  CONTEXT: 30, // unreachable; placeholder for type completeness
};

/** Parse the first positive integer from a provider message (e.g. "45 RPM").
 *  Rejects HTTP status codes (400-599) so "429 Too Many Requests" never
 *  becomes a synthetic ceiling. */
function parseCeiling(message: string | null): number | null {
  if (!message) return null;
  const match = message.match(/(\d{1,7})/);
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  // A bare status code (e.g. 429/500/403) is NOT a rate-limit ceiling.
  if (n >= 400 && n <= 599) return null;
  return n;
}

/**
 * Seed an auto-calibrated, currently-unlimited key with limits derived from
 * its first observed throttle. Returns the new limits (or null if the key is
 * already limited or not auto-calibrated).
 */
export async function seedLimitsOnFirstThrottle(
  apiKeyId: string,
  classification: ErrorClassification,
  providerErrorMessage?: string | null
): Promise<AutoCalibrationLimits | null> {
  const key = await prisma.apiKey.findUnique({ where: { id: apiKeyId } });
  if (!key || !key.autoCalibration) return null;

  // Only seed from a live throttle signal (RATE_LIMITED). Quota/auth/network
  // errors must either suspend the key or use the AIMD path, never seed.
  if (classification !== "RATE_LIMITED") return null;

  const current = currentLimits(key);
  // If the key already has ANY limit, don't reseed — normal AIMD takes over.
  if (!isEmptyMap(current)) return null;

  // Which limit did the provider complain about? If we can't tell (bare 429),
  // DEFAULT to RPM — the most common and impactful signal. The user wants the
  // calibrator to be aware from the very beginning, so the first rate limit
  // must ALWAYS seed something to stop hammering the provider.
  const detected =
    detectLimitFromError(classification, providerErrorMessage ?? null, null) ?? "RPM";

  // Derive the ceiling: explicit number in the message, else the fallback.
  const explicit = parseCeiling(providerErrorMessage ?? null);
  const ceiling =
    detected === "RPM"
      ? explicit ?? SEED_FALLBACKS.RPM
      : explicit ?? SEED_FALLBACKS[detected];

  const baseline: AutoCalibrationLimits = { ...EMPTY_LIMITS };
  const next: AutoCalibrationLimits = { ...EMPTY_LIMITS };
  // Respect the key's min caps (floors) when seeding so the seeded current
  // limit never lands below the user's minimum.
  const minCap = readMinCap(key);
  switch (detected) {
    case "RPM":
      baseline.rpmLimit = ceiling;
      next.rpmLimit = Math.max(
        effectiveFloor(minCap.minRpmLimit, MIN_RPM),
        scaleDownCeiling(ceiling, MIN_RPM)
      );
      break;
    case "TPM":
      baseline.tpmLimit = ceiling;
      next.tpmLimit = Math.max(
        effectiveFloor(minCap.minTpmLimit, MIN_TPM),
        scaleDownCeiling(ceiling, MIN_TPM)
      );
      break;
    case "RPD":
      baseline.rpdLimit = ceiling;
      next.rpdLimit = Math.max(
        effectiveFloor(minCap.minRpdLimit, MIN_RPD),
        scaleDownCeiling(ceiling, MIN_RPD)
      );
      break;
    case "TPD":
      baseline.tpdLimit = ceiling;
      next.tpdLimit = Math.max(
        effectiveFloor(minCap.minTpdLimit, MIN_TPD),
        scaleDownCeiling(ceiling, MIN_TPD)
      );
      break;
  }

  const state: AutoCalibrationState = {
    baseline,
    consecutiveSuccesses: 0,
    lastAdjustmentAt: Date.now(),
  };
  await writeAutoCalibrationState(apiKeyId, state);
  await updateKeyLimits(apiKeyId, next);

  await createAutoCalibrationEvent({
    apiKeyId,
    kind: "SCALE_DOWN",
    limit: detected,
    message: `First throttle (${classification}) — seeded ${detected} limit from provider signal`,
    detail: {
      classification,
      seed: true,
      detected,
      source: explicit ? "provider_message" : "fallback",
      before: current,
      after: next,
      baseline,
    },
  });

  console.error(
    `[auto-cal] key=${apiKeyId.slice(0, 8)} FIRST throttle — seeded ${detected}=${ceiling}` +
      ` (current ${detected}=${next[detected === "RPM" ? "rpmLimit" : detected === "TPM" ? "tpmLimit" : detected === "RPD" ? "rpdLimit" : "tpdLimit"]})`
  );

  return next;
}

// ─── State read/write helpers ─────────────────────────

export async function readAutoCalibrationState(
  apiKeyId: string
): Promise<AutoCalibrationState | null> {
  const key = await prisma.apiKey.findUnique({ where: { id: apiKeyId } });
  if (!key?.autoCalibrationState) return null;
  try {
    return JSON.parse(key.autoCalibrationState) as AutoCalibrationState;
  } catch {
    return null;
  }
}

async function writeAutoCalibrationState(
  apiKeyId: string,
  state: AutoCalibrationState
): Promise<void> {
  await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: { autoCalibrationState: JSON.stringify(state) },
  });
}

async function updateKeyLimits(
  apiKeyId: string,
  limits: AutoCalibrationLimits
): Promise<void> {
  const data: {
    rpmLimit?: number | null;
    tpmLimit?: number | null;
    rpdLimit?: number | null;
    tpdLimit?: number | null;
  } = {};
  if (limits.rpmLimit !== undefined) data.rpmLimit = limits.rpmLimit;
  if (limits.tpmLimit !== undefined) data.tpmLimit = limits.tpmLimit;
  if (limits.rpdLimit !== undefined) data.rpdLimit = limits.rpdLimit;
  if (limits.tpdLimit !== undefined) data.tpdLimit = limits.tpdLimit;
  await prisma.apiKey.update({ where: { id: apiKeyId }, data });
}

// ─── Floor-exhausted stamping ─────────────────────────
// When the calibrator bottoms a key out at its minimum cap, we stamp
// `floorHitAt` on the key. The orchestrator checks this stamp on the NEXT
// throttle: instead of another scale-down no-op + full penalty, it applies a
// SHORT 1-minute RPM penalty and moves to the next healthy key. Any
// successful scale-down/up or manual limit edit clears the stamp.

async function stampFloorHit(apiKeyId: string): Promise<void> {
  await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: { floorHitAt: new Date() },
  });
}

async function clearFloorHit(apiKeyId: string): Promise<void> {
  await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: { floorHitAt: null },
  });
}

/**
 * Whether the key is floor-exhausted: auto-calibration is on, the calibrator
 * has stamped `floorHitAt` (every tunable limit is at its minimum cap), and
 * the stamp is still fresh (the key hasn't been re-tuned since). Used by the
 * orchestrator to decide between "scale down again" and "penalize briefly +
 * fail over".
 */
export async function isKeyFloorExhausted(apiKeyId: string): Promise<boolean> {
  const key = await prisma.apiKey.findUnique({
    where: { id: apiKeyId },
    select: { autoCalibration: true, floorHitAt: true },
  });
  return Boolean(key?.autoCalibration && key.floorHitAt);
}

/** Clear the floor-hit stamp (e.g. after the orchestrator penalizes the key
 *  for being floor-exhausted, or the user edits limits manually). */
export async function clearKeyFloorHit(apiKeyId: string): Promise<void> {
  await clearFloorHit(apiKeyId);
}

function currentLimits(key: {
  rpmLimit: number | null;
  tpmLimit: number | null;
  rpdLimit: number | null;
  tpdLimit: number | null;
}): AutoCalibrationLimits {
  return {
    rpmLimit: key.rpmLimit,
    tpmLimit: key.tpmLimit,
    rpdLimit: key.rpdLimit,
    tpdLimit: key.tpdLimit,
  };
}

/** Read the per-key absolute max (hard cap) from the ApiKey record. */
function readHardCap(key: Record<string, unknown>): HardCapLimits {
  const num = (v: unknown): number | null =>
    typeof v === "number" && v > 0 ? v : v == null ? null : Number(v) > 0 ? Number(v) : null;
  return {
    maxRpmLimit: num(key.maxRpmLimit),
    maxTpmLimit: num(key.maxTpmLimit),
    maxRpdLimit: num(key.maxRpdLimit),
    maxTpdLimit: num(key.maxTpdLimit),
  };
}

/** Read the per-key minimum cap (floor) from the ApiKey record. */
function readMinCap(key: Record<string, unknown>): MinCapLimits {
  const num = (v: unknown): number | null =>
    typeof v === "number" && v > 0 ? v : v == null ? null : Number(v) > 0 ? Number(v) : null;
  return {
    minRpmLimit: num(key.minRpmLimit),
    minTpmLimit: num(key.minTpmLimit),
    minRpdLimit: num(key.minRpdLimit),
    minTpdLimit: num(key.minTpdLimit),
  };
}

/** The effective floor for one limit: the user's min cap when set, else the
 *  built-in minimum. */
function effectiveFloor(minCap: number | null, builtin: number): number {
  return minCap != null && minCap > 0 ? minCap : builtin;
}

/** Multiply a single limit down, respecting a floor and never below 1. */
function scaleDown(value: number | null, floor: number): number | null {
  if (value == null || value <= 0) return value; // unlimited stays unlimited
  return Math.max(floor, Math.round(value * DECREASE_FACTOR));
}

/** Scale a KNOWN-positive ceiling down (seeding path) — never returns null. */
function scaleDownCeiling(ceiling: number, floor: number): number {
  return Math.max(floor, Math.round(ceiling * DECREASE_FACTOR));
}

/**
 * Whether a single limit is already AT (or below) its effective floor — i.e.
 * the calibrator cannot shrink it any further. Unlimited (null) limits are
 * never floor-bound (they aren't being tuned).
 */
function isAtFloor(value: number | null, floor: number): boolean {
  return value != null && value > 0 && value <= floor;
}

/**
 * Detect whether EVERY tunable limit on the key is already at its effective
 * floor (user min cap when set, else the built-in minimum). When true, the
 * calibrator can no longer scale down — the key is "floor-exhausted" and the
 * orchestrator should penalize it briefly (1-min RPM) and fail over instead
 * of hammering the provider at a limit that keeps tripping 429s.
 */
export function isKeyAtFloor(
  limits: AutoCalibrationLimits,
  minCap: MinCapLimits
): boolean {
  const rpmFloor = effectiveFloor(minCap.minRpmLimit, MIN_RPM);
  const tpmFloor = effectiveFloor(minCap.minTpmLimit, MIN_TPM);
  const rpdFloor = effectiveFloor(minCap.minRpdLimit, MIN_RPD);
  const tpdFloor = effectiveFloor(minCap.minTpdLimit, MIN_TPD);

  // A limit counts as "tunable" only when it is set (non-null). Unlimited
  // limits are ignored — they are not being scaled by AIMD.
  const tunable = [
    { value: limits.rpmLimit, floor: rpmFloor },
    { value: limits.tpmLimit, floor: tpmFloor },
    { value: limits.rpdLimit, floor: rpdFloor },
    { value: limits.tpdLimit, floor: tpdFloor },
  ].filter((l) => l.value != null);

  // No limits set at all → nothing is floor-bound (the seeding path owns this).
  if (tunable.length === 0) return false;

  return tunable.every((l) => isAtFloor(l.value as number, l.floor));
}

/** Multiply up toward the baseline ceiling — never exceeds baseline and NEVER
 *  exceeds the per-key hard cap (`max*`). */
function scaleUp(
  current: number | null,
  baseline: number | null,
  floor: number,
  hardCap: number | null = null
): number | null {
  if (current == null || current <= 0) return current; // unlimited stays unlimited
  if (baseline == null) return current; // no ceiling set → no probe limit
  const target = Math.round(current * INCREASE_FACTOR);
  const capped = Math.min(baseline, Math.max(floor, target));
  // Never exceed the explicit hard cap.
  if (hardCap != null && hardCap > 0) return Math.min(capped, hardCap);
  return capped;
}

// ─── Public API used by the orchestrator ──────────────

/**
 * Enable auto-calibration for a key, capturing the key's current limits as
 * the baseline ceiling. Idempotent — safe to call on an already-enabled key
 * (re-captures the baseline on explicit user opt-in).
 */
export async function enableAutoCalibration(apiKeyId: string): Promise<void> {
  const key = await prisma.apiKey.findUnique({ where: { id: apiKeyId } });
  if (!key) return;
  await writeAutoCalibrationState(apiKeyId, {
    baseline: currentLimits(key),
    consecutiveSuccesses: 0,
    lastAdjustmentAt: null,
  });
  await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: { autoCalibration: true },
  });
}

/** Disable auto-calibration and clear its state. */
export async function disableAutoCalibration(apiKeyId: string): Promise<void> {
  await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: { autoCalibration: false, autoCalibrationState: null },
  });
}

/**
 * Called on a provider error. For throttle-like classifications (RATE_LIMITED,
 * and throttling SERVER_ERROR) it scales the key limits down. Returns the new
 * limits (or null if nothing changed).
 */
export async function handleAutoCalibrationFailure(
  apiKeyId: string,
  classification: ErrorClassification,
  providerErrorMessage?: string | null
): Promise<AutoCalibrationLimits | null> {
  const key = await prisma.apiKey.findUnique({ where: { id: apiKeyId } });
  if (!key || !key.autoCalibration) return null;

  // Always log the observed provider error to the timeline so the UI can show
  // "at T it hit <limit>" even when auto-calibration decides not to scale.
  await createAutoCalibrationEvent({
    apiKeyId,
    kind: "FAILURE",
    limit: classification,
    message: `Observed provider error: ${classification}`,
    detail: { classification },
  });

  const isThrottle = classification === "RATE_LIMITED";
  // QUOTA_EXCEEDED / AUTH_ERROR suspend the key, so auto-calibration should
  // not fight them — only live throttle signals drive limit tuning.
  if (!isThrottle) return null;

  // FIRST THROTTLE ON AN UNLIMITED KEY: seed real limits so the calibrator
  // becomes aware from the very beginning (task 01). Without this, an ∞ key
  // stays ∞ forever and the provider gets hammered → 429 → penalized → pool
  // exhausted → "no response returned".
  try {
    const seeded = await seedLimitsOnFirstThrottle(
      apiKeyId,
      classification,
      providerErrorMessage
    );
    if (seeded) return seeded;
  } catch (err) {
    console.error(`[auto-cal] seed-on-first-throttle failed for ${apiKeyId.slice(0, 8)}:`, err);
  }

  let state = await readAutoCalibrationState(apiKeyId);
  if (!state) {
    // State missing (e.g. flag toggled on out-of-band) — rebuild from baseline.
    state = {
      baseline: currentLimits(key),
      consecutiveSuccesses: 0,
      lastAdjustmentAt: null,
    };
  }

  const current = currentLimits(key);
  const minCap = readMinCap(key);
  const next: AutoCalibrationLimits = {
    rpmLimit: scaleDown(current.rpmLimit, effectiveFloor(minCap.minRpmLimit, MIN_RPM)),
    tpmLimit: scaleDown(current.tpmLimit, effectiveFloor(minCap.minTpmLimit, MIN_TPM)),
    rpdLimit: scaleDown(current.rpdLimit, effectiveFloor(minCap.minRpdLimit, MIN_RPD)),
    tpdLimit: scaleDown(current.tpdLimit, effectiveFloor(minCap.minTpdLimit, MIN_TPD)),
  };

  // Avoid infinite writes when nothing can actually shrink.
  if (JSON.stringify(next) === JSON.stringify(current)) {
    // Every limit is already at its effective floor (user min cap or built-in
    // minimum) — the calibrator cannot shrink further. Stamp `floorHitAt` so
    // the orchestrator treats the NEXT throttle on this key as
    // "floor-exhausted": a short 1-minute RPM penalty + failover to the next
    // healthy key, instead of repeatedly hammering a limit that keeps 429ing.
    if (isKeyAtFloor(current, minCap)) {
      await stampFloorHit(apiKeyId);
      await createAutoCalibrationEvent({
        apiKeyId,
        kind: "SCALE_DOWN",
        limit: "RPM",
        message: "Key is at its minimum cap — calibrator cannot scale down further",
        detail: { classification, floorHit: true, before: current, after: next },
      });
      console.error(
        `[auto-cal] key=${apiKeyId.slice(0, 8)} at MINIMUM cap — floor-exhausted ` +
          `(next throttle → 1-min RPM penalty + failover)`
      );
    }
    return null;
  }

  // The key just shrank — clear any stale floor-hit stamp.
  await clearFloorHit(apiKeyId);

  state.consecutiveSuccesses = 0;
  state.lastAdjustmentAt = Date.now();
  await writeAutoCalibrationState(apiKeyId, state);
  await updateKeyLimits(apiKeyId, next);

  await createAutoCalibrationEvent({
    apiKeyId,
    kind: "SCALE_DOWN",
    message: `Rate-limit hit (${classification}) — scaled down limits`,
    detail: {
      classification,
      before: current,
      after: next,
    },
  });

  return next;
}

/**
 * Called on a successful request. Accumulates a success streak; when it
 * crosses the threshold it probes limits UP (capped at baseline) so the key
 * recovers capacity it may have been over-conservatively limited to.
 */
export async function handleAutoCalibrationSuccess(
  apiKeyId: string
): Promise<AutoCalibrationLimits | null> {
  const key = await prisma.apiKey.findUnique({ where: { id: apiKeyId } });
  if (!key || !key.autoCalibration) return null;

  let state = await readAutoCalibrationState(apiKeyId);
  if (!state) {
    state = {
      baseline: currentLimits(key),
      consecutiveSuccesses: 0,
      lastAdjustmentAt: null,
    };
  }

  // Skip probing if all limits are unlimited (nothing to tune).
  if (isEmptyMap(state.baseline)) return null;

  state.consecutiveSuccesses += 1;
  if (state.consecutiveSuccesses < SUCCESS_STREAK_THRESHOLD) {
    await writeAutoCalibrationState(apiKeyId, state);
    return null;
  }

  // Read the per-key hard cap so we can clamp any probe below it.
  const hardCap = readHardCap(key);
  const current = currentLimits(key);
  const next: AutoCalibrationLimits = {
    rpmLimit: scaleUp(current.rpmLimit, state.baseline.rpmLimit, MIN_RPM, hardCap.maxRpmLimit),
    tpmLimit: scaleUp(current.tpmLimit, state.baseline.tpmLimit, MIN_TPM, hardCap.maxTpmLimit),
    rpdLimit: scaleUp(current.rpdLimit, state.baseline.rpdLimit, MIN_RPD, hardCap.maxRpdLimit),
    tpdLimit: scaleUp(current.tpdLimit, state.baseline.tpdLimit, MIN_TPD, hardCap.maxTpdLimit),
  };

  if (JSON.stringify(next) === JSON.stringify(current)) {
    // Already at baseline (or hard cap); keep a fresh streak but do not churn writes.
    state.consecutiveSuccesses = 0;
    await writeAutoCalibrationState(apiKeyId, state);
    return null;
  }

  state.consecutiveSuccesses = 0;
  state.lastAdjustmentAt = Date.now();
  await writeAutoCalibrationState(apiKeyId, state);
  await updateKeyLimits(apiKeyId, next);

  // The key recovered capacity — it is no longer floor-exhausted.
  await clearFloorHit(apiKeyId);

  await createAutoCalibrationEvent({
    apiKeyId,
    kind: "SCALE_UP",
    message: `Success streak reached ${SUCCESS_STREAK_THRESHOLD} — probed limits up toward baseline`,
    detail: {
      streak: SUCCESS_STREAK_THRESHOLD,
      before: current,
      after: next,
    },
  });

  return next;
}

/** Reset the baseline to the current limits (e.g. user manually re-tuned). */
export async function resetAutoCalibrationBaseline(
  apiKeyId: string
): Promise<AutoCalibrationState | null> {
  const key = await prisma.apiKey.findUnique({ where: { id: apiKeyId } });
  if (!key || !key.autoCalibration) return null;
  const state: AutoCalibrationState = {
    baseline: currentLimits(key),
    consecutiveSuccesses: 0,
    lastAdjustmentAt: null,
  };
  await writeAutoCalibrationState(apiKeyId, state);
  // Manual re-tune clears the floor-exhausted stamp.
  await clearFloorHit(apiKeyId);

  await createAutoCalibrationEvent({
    apiKeyId,
    kind: "BASELINE_RESET",
    message: "Auto-calibration baseline re-captured from current limits",
    detail: { baseline: state.baseline },
  });

  return state;
}
