// ─── Health Engine ──────────────────────────────────────
// Implements the penalty/suspension state machine
// specified in §10 of the architecture plan.

import { prisma } from "@/lib/prisma";
import { ErrorClassification } from "./error-classifier";

export interface HealthUpdateInput {
  apiKeyId: string;
  errorClassification: ErrorClassification;
}

export interface HealthActionResult {
  keyId: string;
  newStatus: string;
  penaltyLevel: number;
  penaltyExpiresAt: Date | null;
  suspendedReason: string | null;
}

async function getSettings() {
  const settings = await prisma.appSettings.findUnique({ where: { id: "singleton" } });
  return {
    baseCooldown: settings?.penaltyBaseCooldownSeconds ?? 600,
    multiplier: settings?.penaltyMultiplier ?? 3,
    maxCooldown: settings?.penaltyMaxCooldownSeconds ?? 21600,
    resetWindow: settings?.penaltyResetWindowSeconds ?? 3600,
  };
}

export async function applyFailure(input: HealthUpdateInput): Promise<HealthActionResult> {
  const { apiKeyId, errorClassification } = input;

  // Don't penalize for invalid requests
  if (errorClassification === "INVALID_REQUEST") {
    const key = await prisma.apiKey.findUnique({ where: { id: apiKeyId } });
    return {
      keyId: apiKeyId,
      newStatus: key?.status ?? "ACTIVE",
      penaltyLevel: key?.penaltyLevel ?? 0,
      penaltyExpiresAt: key?.penaltyExpiresAt ?? null,
      suspendedReason: null,
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
      },
    });
    return {
      keyId: apiKeyId,
      newStatus: key.status,
      penaltyLevel: key.penaltyLevel,
      penaltyExpiresAt: key.penaltyExpiresAt,
      suspendedReason: key.suspendedReason,
    };
  }

  // Penalize for recoverable errors
  const settings = await getSettings();
  const now = new Date();

  const key = await prisma.apiKey.findUnique({ where: { id: apiKeyId } });
  if (!key) throw new Error(`ApiKey not found: ${apiKeyId}`);

  let newLevel: number;
  let cooldownSeconds: number;

  const shouldReset =
    key.penaltyLevel === 0 ||
    !key.lastPenaltyEndedAt ||
    now.getTime() - key.lastPenaltyEndedAt.getTime() > settings.resetWindow * 1000;

  if (shouldReset) {
    newLevel = 1;
    cooldownSeconds = settings.baseCooldown;
  } else {
    newLevel = key.penaltyLevel + 1;
    cooldownSeconds = Math.min(
      settings.baseCooldown * Math.pow(settings.multiplier, newLevel - 1),
      settings.maxCooldown
    );
  }

  const penaltyExpiresAt = new Date(now.getTime() + cooldownSeconds * 1000);

  await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: {
      status: "PENALIZED",
      penaltyLevel: newLevel,
      penaltyExpiresAt,
      consecutiveFailures: { increment: 1 },
      lastUsedAt: now,
    },
  });

  return {
    keyId: apiKeyId,
    newStatus: "PENALIZED",
    penaltyLevel: newLevel,
    penaltyExpiresAt,
    suspendedReason: null,
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
      lastPenaltyEndedAt: now,
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
    },
  });
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
