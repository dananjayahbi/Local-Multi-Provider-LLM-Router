// ─── Discovery Request Data Access ─────────────────────
// CRUD for user-triggered research sessions consumed by the
// Hermes agent.

import { prisma } from "@/lib/prisma";

export interface CreateDiscoveryRequestInput {
  prompt?: string | null;
}

export async function createDiscoveryRequest(data: CreateDiscoveryRequestInput) {
  return prisma.discoveryRequest.create({
    data: {
      prompt: data.prompt ?? null,
      status: "PENDING",
    },
  });
}

export async function getDiscoveryRequests(limit = 50) {
  return prisma.discoveryRequest.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function getPendingDiscoveryRequest() {
  return prisma.discoveryRequest.findFirst({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });
}

export async function markDiscoveryRequestRunning(id: string) {
  return prisma.discoveryRequest.update({
    where: { id },
    data: { status: "RUNNING", startedAt: new Date() },
  });
}

export async function completeDiscoveryRequest(id: string, resultCount: number) {
  return prisma.discoveryRequest.update({
    where: { id },
    data: { status: "COMPLETED", resultCount, completedAt: new Date() },
  });
}

export async function failDiscoveryRequest(id: string, error: string) {
  return prisma.discoveryRequest.update({
    where: { id },
    data: { status: "FAILED", error, completedAt: new Date() },
  });
}
