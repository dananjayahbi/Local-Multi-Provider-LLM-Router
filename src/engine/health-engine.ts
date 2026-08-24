// ─── Health Engine ──────────────────────────────────────
// Implements the penalty/suspension state machine
// specified in §10 of the architecture plan.

import { prisma } from "@/lib/prisma";
import { ErrorClassification } from "./error-classifier";
import { detectLimitFromError, resolvePenaltyDecision } from "./penalty-application";
import { resolveManualPenalty } from "./manual-penalty";

export interface HealthUpdateInput {
  apiKeyId: string;
  errorClassification: ErrorClassification;
  /** Raw provider message/code so we can detect WHICH limit was hit (task 04). */
  providerErrorMessage?: string | null;
  providerErrorCode?: string | null;
}

export interface HealthActionResult {
  keyId: string;
  newStatus: string;
  penaltyLevel: number;
  penaltyExpiresAt: Date | null;
  suspendedReason: string | null;
  penaltyType: string | null;
  penaltyReason: string | null;
}

export async function getSettings() {
  const settings = await prisma.appSettings.findUnique({ where: { id: "singleton" } });
  return {
    baseCooldown: settings?.penaltyBaseCooldownSeconds ?? 600,
    multiplier: settings?.penaltyMultiplier ?? 3,
    maxCooldown: settings?.penaltyMaxCooldownSeconds ?? 21600,
    resetWindowSeconds: settings?.penaltyResetWindowSeconds ?? 3600,
  };
}

export async function applyFailure(input: HealthUpdateInput): Promise<HealthActionResult> {
  const { apiKeyId, errorClassification, providerErrorMessage, providerErrorCode } = input;

  // Don't penalize for invalid requests
  if (errorClassification === "INVALID_REQUEST") {
    const key = await prisma.apiKey.findUnique({ where: { id: apiKeyId } });
    return {
      keyId: apiKeyId,
      newStatus: key?.status ?? "ACTIVE",
      penaltyLevel: key?.penaltyLevel ?? 0,
      penaltyExpiresAt: key?.penaltyExpiresAt ?? null,
      suspendedReason: null,
      penaltyType: key?.penaltyType ?? null,
      penaltyReason: key?.penaltyReason ?? null,
    };
  }

  // Suspend for terminal errors
  if (errorClassification === "QUOTA_EXCEEDED" || errorClassification === "AUTH_ERROR") {
    const key = await prisma.apiKey.update({
      where: { id: apiKeyId },
      data: {
        status: "SUSPENDED",
        suspendedReason:
          errorClassification === "QUOTA_EXCEEDED" ? "quota_exceeded" : "invalid_credentials",
        consecutiveFailures: { increment: 1 },
        lastUsedAt: new Date(),
        penaltyType: null,
        penaltyReason: null,
      },
    });
    return {
      keyId: apiKeyId,
      newStatus: key.status,
      penaltyLevel: key.penaltyLevel,
      penaltyExpiresAt: key.penaltyExpiresAt,
      suspendedReason: key.suspendedReason,
      penaltyType: null,
      penaltyReason: null,
    };
  }

  // Penalize for recoverable errors
  const settings = await getSettings();
  const now = new Date();

  const key = await prisma.apiKey.findUnique({ where: { id: apiKeyId } });
  if (!key) throw new Error(`ApiKey not found: ${apiKeyId}`);

  // Task 04: detect WHICH limit was hit (if any) and pick the penalty type.
  const detectedLimit = detectLimitFromError(
    errorClassification,
    providerErrorMessage ?? null,
    providerErrorCode ?? null
  );
  const decision = resolvePenaltyDecision(
    errorClassification,
    detectedLimit,
    {
      currentPenaltyLevel: key.penaltyLevel,
      lastPenaltyEndedAt: key.lastPenaltyEndedAt,
      now,
      autoCalibration: key.autoCalibration,
    },
    settings
  );

  const penaltyExpiresAt = new Date(now.getTime() + decision.cooldownSeconds * 1000);

  await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: {
      status: "PENALIZED",
      penaltyLevel: decision.penaltyLevel,
      penaltyExpiresAt,
      penaltyType: decision.penaltyType,
      penaltyReason: decision.penaltyReason,
      consecutiveFailures: { increment: 1 },
      lastUsedAt: now,
    },
  });

  console.error(
    `[health] key=${apiKeyId.slice(0, 8)} penalized (${decision.penaltyType}) ` +
      `reason=${decision.penaltyReason} level=${decision.penaltyLevel} ` +
      `cooldown=${decision.cooldownSeconds}s`
  );

  return {
    keyId: apiKeyId,
    newStatus: "PENALIZED",
    penaltyLevel: decision.penaltyLevel,
    penaltyExpiresAt,
    suspendedReason: null,
    penaltyType: decision.penaltyType,
    penaltyReason: decision.penaltyReason,
  };
}

export async function checkAndRecoverExpiredPenalties(): Promise<number> {
  const now = new Date();
  const result = await prisma.apiKey.updateMany({
    where: {
      status: "PENALIZED",
      penaltyExpiresAt: { lte: now },
    },
    data: {
      status: "ACTIVE",
      penaltyLevel: 0,
      lastPenaltyEndedAt: now,
      penaltyType: null,
      penaltyReason: null,
    },
  });
  return result.count;
}

export async function suspendKey(apiKeyId: string, reason: string): Promise<void> {
  await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: {
      status: "SUSPENDED",
      suspendedReason: reason,
      manuallyDisabled: false,
      penaltyType: null,
      penaltyReason: null,
    },
  });
}

export async function reactivateKey(apiKeyId: string): Promise<void> {
  await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: {
      status: "ACTIVE",
      suspendedReason: null,
      penaltyLevel: 0,
      penaltyExpiresAt: null,
      lastPenaltyEndedAt: null,
      consecutiveFailures: 0,
      manuallyDisabled: false,
      penaltyType: null,
      penaltyReason: null,
    },
  });
}

export async function disableKey(apiKeyId: string): Promise<void> {
  await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: {
      status: "DISABLED",
      manuallyDisabled: true,
    },
  });
}

export async function enableKey(apiKeyId: string): Promise<void> {
  await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: {
      status: "ACTIVE",
      manuallyDisabled: false,
      suspendedReason: null,
    },
  });
}

export async function resetPenalty(apiKeyId: string): Promise<void> {
  await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: {
      status: "ACTIVE",
      penaltyLevel: 0,
      penaltyExpiresAt: null,
      lastPenaltyEndedAt: null,
      consecutiveFailures: 0,
      suspendedReason: null,
      penaltyType: null,
      penaltyReason: null,
    },
  });
}

/**
 * Manually apply a penalty to a key — either by escalation level (cooldown
 * derived from the variable-penalty backoff) or a custom cooldown (seconds).
 * Used by the admin UI "Penalty" button. Always sets status PENALIZED.
 */
export async function applyManualPenalty(
  apiKeyId: string,
  opts: { level?: number; cooldownSeconds?: number }
): Promise<HealthActionResult> {
  const decision = resolveManualPenalty(opts, await getSettings());
  const now = new Date();
  const penaltyExpiresAt = new Date(now.getTime() + decision.cooldownSeconds * 1000);

  const key = await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: {
      status: "PENALIZED",
      penaltyLevel: decision.penaltyLevel,
      penaltyExpiresAt,
      penaltyType: "VARIABLE",
      penaltyReason: "manual",
      suspendedReason: null,
      lastUsedAt: now,
    },
  });

  console.error(
    `[health] key=${apiKeyId.slice(0, 8)} manually penalized level=${decision.penaltyLevel} cooldown=${decision.cooldownSeconds}s`
  );

  return {
    keyId: apiKeyId,
    newStatus: "PENALIZED",
    penaltyLevel: decision.penaltyLevel,
    penaltyExpiresAt,
    suspendedReason: null,
    penaltyType: "VARIABLE",
    penaltyReason: "manual",
  };
}

export async function resetKeyHealth(apiKeyId: string): Promise<void> {
  await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: {
      consecutiveFailures: 0,
      lastUsedAt: new Date(),
    },
  });
}

// ─── Benchmark State Transitions ────────────────────────
// Extends the state machine with TESTING and COOLDOWN states.

export async function setKeyTesting(apiKeyId: string): Promise<void> {
  await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: { status: "TESTING" },
  });
}

export async function setKeyCooldown(apiKeyId: string, cooldownSeconds: number): Promise<void> {
  await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: {
      status: "COOLDOWN",
      penaltyExpiresAt: new Date(Date.now() + cooldownSeconds * 1000),
    },
  });
}

export async function setKeyActive(apiKeyId: string): Promise<void> {
  await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: {
      status: "ACTIVE",
      penaltyLevel: 0,
      penaltyExpiresAt: null,
      lastPenaltyEndedAt: null,
      consecutiveFailures: 0,
      suspendedReason: null,
      manuallyDisabled: false,
      penaltyType: null,
      penaltyReason: null,
    },
  });
}

/**
 * Marks a key as calibrated after a successful benchmark run.
 * This lets users easily identify keys whose configs have been
 * validated and tuned.
 */
export async function markKeyCalibrated(apiKeyId: string): Promise<void> {
  await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: {
      calibrated: true,
      lastCalibratedAt: new Date(),
    },
  });
}

/**
 * Recovers keys that finished their COOLDOWN period back to ACTIVE.
 * Called at the start of orchestration and by the scheduler.
 */
export async function checkAndRecoverExpiredCooldowns(): Promise<number> {
  const now = new Date();
  const result = await prisma.apiKey.updateMany({
    where: {
      status: "COOLDOWN",
      penaltyExpiresAt: { lte: now },
    },
    data: {
      status: "ACTIVE",
      penaltyExpiresAt: null,
    },
  });
  return result.count;
}
