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

export async function deleteProvider(id: string) {
  // Check if any of this provider's models are referenced by PoolMembers
  const blockingPools = await prisma.poolMember.findMany({
    where: { providerModel: { providerId: id } },
    include: {
      pool: { select: { id: true, name: true } },
      providerModel: { select: { id: true, displayName: true } },
    },
  });

  if (blockingPools.length > 0) {
    const poolNames = [...new Set(blockingPools.map((m) => m.pool.name))];
    throw new Error(
      `Cannot delete provider: its models are referenced by pool(s): ${poolNames.join(", ")}. Remove the models from those pools first.`
    );
  }

  await prisma.provider.delete({ where: { id } });
}
