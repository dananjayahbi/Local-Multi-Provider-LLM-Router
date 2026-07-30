// ─── Provider Model Data Access ────────────────────────

import { prisma } from "@/lib/prisma";

export async function getModelsByProvider(providerId: string) {
  return prisma.providerModel.findMany({
    where: { providerId },
    orderBy: { displayName: "asc" },
  });
}

export async function getModelById(id: string) {
  return prisma.providerModel.findUnique({ where: { id } });
}

export async function createProviderModel(
  providerId: string,
  data: {
    modelId: string;
    displayName: string;
    supportsVision?: boolean;
    supportsFunctionCalling?: boolean;
    contextWindow?: number;
  }
) {
  return prisma.providerModel.create({
    data: {
      providerId,
      ...data,
    },
  });
}

export async function updateProviderModel(
  id: string,
  data: {
    modelId?: string;
    displayName?: string;
    supportsVision?: boolean;
    supportsFunctionCalling?: boolean;
    contextWindow?: number;
    enabled?: boolean;
  }
) {
  return prisma.providerModel.update({ where: { id }, data });
}

export async function deleteProviderModel(id: string) {
  // Check if referenced by any PoolMembers
  const blockingPools = await prisma.poolMember.findMany({
    where: { providerModelId: id },
    include: { pool: { select: { id: true, name: true } } },
  });

  if (blockingPools.length > 0) {
    const poolNames = [...new Set(blockingPools.map((m) => m.pool.name))];
    throw new Error(
      `Cannot delete model: it is referenced by pool(s): ${poolNames.join(", ")}. Remove it from those pools first.`
    );
  }

  await prisma.providerModel.delete({ where: { id } });
}
