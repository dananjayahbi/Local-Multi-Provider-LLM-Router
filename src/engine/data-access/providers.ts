// ─── Provider Data Access ──────────────────────────────

import { prisma } from "@/lib/prisma";

export async function getAllProviders() {
  return prisma.provider.findMany({
    include: {
      _count: { select: { apiKeys: true, providerModels: true } },
    },
    orderBy: { name: "asc" },
  });
}

export async function getProviderById(id: string) {
  return prisma.provider.findUnique({
    where: { id },
    include: {
      apiKeys: { orderBy: { createdAt: "asc" } },
      providerModels: { orderBy: { displayName: "asc" } },
    },
  });
}

export async function createProvider(data: {
  name: string;
  baseUrl: string;
  apiFormat: string;
  notes?: string;
}) {
  return prisma.provider.create({ data });
}

export async function updateProvider(
  id: string,
  data: { name?: string; baseUrl?: string; apiFormat?: string; notes?: string }
) {
  return prisma.provider.update({ where: { id }, data });
}

/**
 * Delete a provider and everything downstream, with auto-detach:
 * 1. Detach — remove any PoolMember rows that reference this provider's
 *    models so no pool keeps a dangling member (auto-detach from pools).
 * 2. Cascade — delete the provider. The schema's `onDelete: Cascade` on
 *    ApiKey.provider, ProviderModel.provider and CalibrationSession.provider
 *    removes all keys, models and calibration history in the same transaction.
 *
 * The whole thing runs in a single transaction so a failure never leaves a
 * half-deleted provider behind.
 */
export async function deleteProvider(id: string) {
  const modelIds = (
    await prisma.providerModel.findMany({
      where: { providerId: id },
      select: { id: true },
    })
  ).map((m) => m.id);

  await prisma.$transaction([
    // Auto-detach this provider's models from every pool that uses them.
    prisma.poolMember.deleteMany({
      where: { providerModelId: { in: modelIds } },
    }),
    // Cascade-delete the provider (models, apiKeys, calibrationSessions).
    prisma.provider.delete({ where: { id } }),
  ]);
}
