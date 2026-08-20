// ─── Discovery Event Data Access ───────────────────────
// CRUD for the live agent-conversation stream attached to a
// discovery request. The Hermes agent appends events as it
// works; the UI polls them to render a real-time transcript.

import { prisma } from "@/lib/prisma";

export type DiscoveryEventKind =
  | "INFO"
  | "SEARCH"
  | "FETCH"
  | "EXTRACT"
  | "STAGE"
  | "SKIP"
  | "ERROR"
  | "DONE";

export interface CreateDiscoveryEventInput {
  requestId: string;
  kind: DiscoveryEventKind;
  message: string;
  detail?: string | null;
}

export async function createDiscoveryEvent(data: CreateDiscoveryEventInput) {
  return prisma.discoveryEvent.create({
    data: {
      requestId: data.requestId,
      kind: data.kind,
      message: data.message,
      detail: data.detail ?? null,
    },
  });
}

export async function getDiscoveryEvents(requestId: string, limit = 500) {
  return prisma.discoveryEvent.findMany({
    where: { requestId },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

export async function getDiscoveryEventsSince(requestId: string, sinceId?: string) {
  return prisma.discoveryEvent.findMany({
    where: { requestId, ...(sinceId ? { id: { gt: sinceId } } : {}) },
    orderBy: { createdAt: "asc" },
  });
}
