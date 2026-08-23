// ─── Calibration Session Data Access ───────────────────
// CRUD for agent-driven calibration sessions. A session is
// scoped to ONE provider, ONE key, and ONE model. The Hermes
// agent researches the provider's free-quota rate limits from
// the web (no key stressing) and stores the findings here until
// the user reviews and applies them to the key manually.

import { prisma } from "@/lib/prisma";
import { updateApiKey } from "./api-keys";

export interface CreateCalibrationSessionInput {
  providerId: string;
  apiKeyId: string;
  providerModelId: string;
}

export interface RateLimitFindings {
  rpm?: number | null;
  tpm?: number | null;
  rpd?: number | null;
  tpd?: number | null;
  tps?: number | null;
  contextWindow?: number | null;
  timeToFirstTokenMs?: number | null;
  sources?: Array<{ label: string; url: string }>;
  notes?: string;
}

export async function createCalibrationSession(data: CreateCalibrationSessionInput) {
  return prisma.calibrationSession.create({
    data: {
      providerId: data.providerId,
      apiKeyId: data.apiKeyId,
      providerModelId: data.providerModelId,
      status: "PENDING",
    },
  });
}

export async function getCalibrationSession(id: string) {
  return prisma.calibrationSession.findUnique({
    where: { id },
    include: {
      provider: { select: { id: true, name: true, baseUrl: true } },
      apiKey: { select: { id: true, label: true } },
      providerModel: { select: { id: true, displayName: true } },
    },
  });
}

export async function getCalibrationSessions(limit = 20, status?: string) {
  return prisma.calibrationSession.findMany({
    where: status ? { status } : undefined,
    include: {
      provider: { select: { id: true, name: true } },
      apiKey: { select: { id: true, label: true } },
      providerModel: { select: { id: true, displayName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/** Next PENDING session, oldest first (one provider at a time). */
export async function getPendingCalibrationSession() {
  return prisma.calibrationSession.findFirst({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });
}

export async function markCalibrationSessionRunning(id: string) {
  return prisma.calibrationSession.update({
    where: { id },
    data: { status: "RUNNING", startedAt: new Date() },
  });
}

export async function completeCalibrationSession(id: string, findings: RateLimitFindings) {
  return prisma.calibrationSession.update({
    where: { id },
    data: { status: "COMPLETED", findings: JSON.stringify(findings), completedAt: new Date() },
  });
}

export async function failCalibrationSession(id: string, error: string) {
  return prisma.calibrationSession.update({
    where: { id },
    data: { status: "FAILED", error, completedAt: new Date() },
  });
}

/**
 * Applies a COMPLETED session's findings to its provider-level
 * API key. Idempotent via the `applied` flag. Only rate-limit /
 * token fields present in the findings are written; the rest of
 * the key is left untouched.
 */
export async function applyCalibrationFindings(id: string) {
  const session = await prisma.calibrationSession.findUnique({ where: { id } });
  if (!session) throw new Error("Calibration session not found");
  if (session.status !== "COMPLETED") {
    throw new Error("Session must be COMPLETED before applying findings");
  }
  if (session.applied) {
    throw new Error("Findings already applied to the key");
  }
  if (!session.findings) throw new Error("Session has no findings to apply");

  const findings = JSON.parse(session.findings) as RateLimitFindings;

  const patch: {
    rpmLimit?: number | null;
    tpmLimit?: number | null;
    rpdLimit?: number | null;
    tpdLimit?: number | null;
    tps?: number | null;
    contextWindow?: number | null;
  } = {};
  if (findings.rpm != null) patch.rpmLimit = findings.rpm;
  if (findings.tpm != null) patch.tpmLimit = findings.tpm;
  if (findings.rpd != null) patch.rpdLimit = findings.rpd;
  if (findings.tpd != null) patch.tpdLimit = findings.tpd;
  if (findings.tps != null) patch.tps = findings.tps;
  if (findings.contextWindow != null) patch.contextWindow = findings.contextWindow;

  if (Object.keys(patch).length === 0) {
    throw new Error("No usable rate-limit values found to apply");
  }

  await updateApiKey(session.apiKeyId, patch);

  return prisma.calibrationSession.update({
    where: { id },
    data: { applied: true },
  });
}

/** Convenience parser for the UI to render findings. */
export function parseFindings(findings: string | null | undefined): RateLimitFindings | null {
  if (!findings) return null;
  try {
    return JSON.parse(findings) as RateLimitFindings;
  } catch {
    return null;
  }
}
