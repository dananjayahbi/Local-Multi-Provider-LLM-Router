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

/** Multiply a single limit down, respecting a floor and never below 1. */
function scaleDown(value: number | null, floor: number): number | null {
  if (value == null || value <= 0) return value; // unlimited stays unlimited
  return Math.max(floor, Math.round(value * DECREASE_FACTOR));
}

/** Multiply up toward the baseline ceiling — never exceeds baseline. */
function scaleUp(
  current: number | null,
  baseline: number | null,
  floor: number
): number | null {
  if (current == null || current <= 0) return current; // unlimited stays unlimited
  if (baseline == null) return current; // no ceiling set → no probe limit
  const target = Math.round(current * INCREASE_FACTOR);
  return Math.min(baseline, Math.max(floor, target));
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
  classification: ErrorClassification
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
  const next: AutoCalibrationLimits = {
    rpmLimit: scaleDown(current.rpmLimit, MIN_RPM),
    tpmLimit: scaleDown(current.tpmLimit, MIN_TPM),
    rpdLimit: scaleDown(current.rpdLimit, MIN_RPD),
    tpdLimit: scaleDown(current.tpdLimit, MIN_TPD),
  };

  // Avoid infinite writes when nothing can actually shrink.
  if (JSON.stringify(next) === JSON.stringify(current)) return null;

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

  const current = currentLimits(key);
  const next: AutoCalibrationLimits = {
    rpmLimit: scaleUp(current.rpmLimit, state.baseline.rpmLimit, MIN_RPM),
    tpmLimit: scaleUp(current.tpmLimit, state.baseline.tpmLimit, MIN_TPM),
    rpdLimit: scaleUp(current.rpdLimit, state.baseline.rpdLimit, MIN_RPD),
    tpdLimit: scaleUp(current.tpdLimit, state.baseline.tpdLimit, MIN_TPD),
  };

  if (JSON.stringify(next) === JSON.stringify(current)) {
    // Already at baseline; keep a fresh streak but do not churn writes.
    state.consecutiveSuccesses = 0;
    await writeAutoCalibrationState(apiKeyId, state);
    return null;
  }

  state.consecutiveSuccesses = 0;
  state.lastAdjustmentAt = Date.now();
  await writeAutoCalibrationState(apiKeyId, state);
  await updateKeyLimits(apiKeyId, next);

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

  await createAutoCalibrationEvent({
    apiKeyId,
    kind: "BASELINE_RESET",
    message: "Auto-calibration baseline re-captured from current limits",
    detail: { baseline: state.baseline },
  });

  return state;
}
