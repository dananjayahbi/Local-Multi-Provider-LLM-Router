// ─── Calibration Event Data Access ─────────────────────
// Live activity stream for a calibration session. The Hermes
// agent appends events as it researches the provider's rate
// limits so the UI renders the agent's progress in real time
// (mirrors DiscoveryEvent).

import { prisma } from "@/lib/prisma";

export type CalibrationEventKind =
  | "INFO"
  | "SEARCH"
  | "FETCH"
  | "EXTRACT"
  | "RESULT"
  | "ERROR"
  | "DONE";

export interface CreateCalibrationEventInput {
  sessionId: string;
  kind: CalibrationEventKind;
  message: string;
  detail?: string | null;
}

export async function createCalibrationEvent(data: CreateCalibrationEventInput) {
  return prisma.calibrationEvent.create({
    data: {
      sessionId: data.sessionId,
      kind: data.kind,
      message: data.message,
      detail: data.detail ?? null,
    },
  });
}

/** Incremental poll: return only events created after `sinceId`. */
export async function getCalibrationEventsSince(sessionId: string, sinceId?: string) {
  return prisma.calibrationEvent.findMany({
    where: {
      sessionId,
      ...(sinceId ? { id: { gt: sinceId } } : {}),
    },
    orderBy: { createdAt: "asc" },
  });
}
