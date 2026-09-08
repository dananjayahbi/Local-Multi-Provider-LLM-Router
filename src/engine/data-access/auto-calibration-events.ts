// ─── Auto-Calibration Event Data Access ────────────────
// Timeline of limit adjustments and observed provider signals for a single
// auto-calibrated key. The orchestrator / auto-calibration engine appends
// one row per adjustment so the "Auto Calibrations" page can render a
// detailed, filterable history.

import { prisma } from "@/lib/prisma";

export type AutoCalibrationEventKind =
  | "FAILURE" // observed provider error (rate-limit / throttled)
  | "SUCCESS" // a successful request (streak accumulator tick)
  | "SCALE_DOWN" // limits scaled down after a throttle hit
  | "SCALE_UP" // limits probed up after a success streak
  | "BASELINE_RESET"; // user re-captured the baseline ceiling

export interface CreateAutoCalibrationEventInput {
  apiKeyId: string;
  kind: AutoCalibrationEventKind;
  limit?: string | null;
  message: string;
  detail?: Record<string, unknown> | null;
}

export async function createAutoCalibrationEvent(
  data: CreateAutoCalibrationEventInput
): Promise<void> {
  await prisma.autoCalibrationEvent.create({
    data: {
      apiKeyId: data.apiKeyId,
      kind: data.kind,
      limit: data.limit ?? null,
      message: data.message,
      detail: data.detail ? JSON.stringify(data.detail) : null,
    },
  });
}

/** All events for a key, newest first. */
export async function getAutoCalibrationEvents(apiKeyId: string) {
  return prisma.autoCalibrationEvent.findMany({
    where: { apiKeyId },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Timeline across ALL auto-calibrated keys (optionally filtered by key label /
 * provider / pool). Newest first, joins the key so the UI can show the label.
 */
export async function getAutoCalibrationTimeline(filters: {
  apiKeyId?: string;
  poolId?: string;
  providerId?: string;
  limit?: number;
} = {}) {
  const { apiKeyId, poolId, providerId, limit = 200 } = filters;

  const keyWhere: Record<string, unknown> = {};
  if (apiKeyId) keyWhere.id = apiKeyId;
  if (providerId) keyWhere.providerId = providerId;
  if (poolId) keyWhere.poolApiKeys = { some: { poolId } };

  const events = await prisma.autoCalibrationEvent.findMany({
    where: keyWhere.apiKeyId ? { apiKeyId } : { apiKey: keyWhere },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      apiKey: {
        select: {
          id: true,
          label: true,
          autoCalibration: true,
          provider: { select: { id: true, name: true } },
        },
      },
    },
  });

  return events.map((e) => ({
    id: e.id,
    kind: e.kind,
    limit: e.limit,
    message: e.message,
    detail: e.detail ? JSON.parse(e.detail) : null,
    createdAt: e.createdAt,
    key: e.apiKey,
  }));
}

/**
 * Summaries for the timeline header: per-key latest limits + current state,
 * so the "Auto Calibrations" page can show applied parameters per key.
 */
export async function getAutoCalibrationKeys(filters: { providerId?: string } = {}) {
  const keys = await prisma.apiKey.findMany({
    where: {
      autoCalibration: true,
      ...(filters.providerId ? { providerId: filters.providerId } : {}),
    },
    orderBy: { label: "asc" },
    select: {
      id: true,
      label: true,
      status: true,
      penaltyLevel: true,
      penaltyExpiresAt: true,
      autoCalibration: true,
      autoCalibrationState: true,
      rpmLimit: true,
      tpmLimit: true,
      rpdLimit: true,
      tpdLimit: true,
      tps: true,
      minRpmLimit: true,
      minTpmLimit: true,
      minRpdLimit: true,
      minTpdLimit: true,
      maxRpmLimit: true,
      maxTpmLimit: true,
      maxRpdLimit: true,
      maxTpdLimit: true,
      floorHitAt: true,
      provider: { select: { id: true, name: true } },
    },
  });

  return keys.map((k) => ({
    id: k.id,
    label: k.label,
    status: k.status,
    penaltyLevel: k.penaltyLevel,
    penaltyExpiresAt: k.penaltyExpiresAt,
    autoCalibration: k.autoCalibration,
    autoCalibrationState: k.autoCalibrationState ? JSON.parse(k.autoCalibrationState) : null,
    rpmLimit: k.rpmLimit,
    tpmLimit: k.tpmLimit,
    rpdLimit: k.rpdLimit,
    tpdLimit: k.tpdLimit,
    tps: k.tps,
    minRpmLimit: k.minRpmLimit,
    minTpmLimit: k.minTpmLimit,
    minRpdLimit: k.minRpdLimit,
    minTpdLimit: k.minTpdLimit,
    maxRpmLimit: k.maxRpmLimit,
    maxTpmLimit: k.maxTpmLimit,
    maxRpdLimit: k.maxRpdLimit,
    maxTpdLimit: k.maxTpdLimit,
    floorHitAt: k.floorHitAt,
    provider: k.provider,
  }));
}
