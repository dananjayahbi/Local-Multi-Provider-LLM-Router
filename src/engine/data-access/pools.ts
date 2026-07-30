// ─── Pool Data Access ──────────────────────────────────

import { prisma } from "@/lib/prisma";

const poolInclude = {
  poolMembers: {
    include: {
      providerModel: {
        include: {
          provider: {
            include: {
              apiKeys: {
                select: {
                  id: true,
                  label: true,
                  secretEncrypted: true,
                  status: true,
                  penaltyExpiresAt: true,
                  penaltyLevel: true,
                  lastUsedAt: true,
                  suspendedReason: true,
                  manuallyDisabled: true,
                },
              },
            },
          },
        },
      },
    },
  },
  _count: { select: { poolMembers: true } },
};

export async function getAllPools() {
  const pools = await prisma.pool.findMany({
    include: {
      poolMembers: {
        include: {
          providerModel: {
            include: {
              provider: {
                include: {
                  apiKeys: { select: { id: true, status: true } },
                },
              },
            },
          },
        },
      },
      _count: { select: { poolMembers: true } },
    },
    orderBy: { name: "asc" },
  });

  return pools.map((p) => {
    const allKeys: { id: string; status: string }[] = [];
    for (const member of p.poolMembers) {
      for (const key of member.providerModel.provider.apiKeys) {
        allKeys.push(key);
      }
    }
    const healthy = allKeys.filter((k) => k.status === "ACTIVE").length;
    const total = allKeys.length;
    return { ...p, healthyKeys: healthy, totalKeys: total };
  });
}

export async function getPoolById(id: string) {
  return prisma.pool.findUnique({
    where: { id },
    include: poolInclude,
  });
}

export async function createPool(
  data: {
    name: string;
    virtualModelName: string;
    description?: string;
    routingStrategy?: string;
  },
  members: Array<{ providerModelId: string; priority?: number }>
) {
  return prisma.pool.create({
    data: {
      name: data.name,
      virtualModelName: data.virtualModelName,
      description: data.description,
      routingStrategy: data.routingStrategy ?? "ROUND_ROBIN",
      poolMembers: {
        create: members.map((m) => ({
          providerModelId: m.providerModelId,
          priority: m.priority ?? 0,
        })),
      },
    },
    include: poolInclude,
  });
}

export async function createQuickPool(providerModelId: string, virtualModelName: string) {
  const model = await prisma.providerModel.findUnique({
    where: { id: providerModelId },
    include: { provider: true },
  });
  if (!model) throw new Error("Provider model not found");

  return prisma.pool.create({
    data: {
      name: `Pool: ${model.provider.name} / ${model.displayName}`,
      virtualModelName,
      description: `Quick pool for ${model.provider.name} → ${model.displayName}`,
      routingStrategy: "ROUND_ROBIN",
      poolMembers: {
        create: [{ providerModelId, priority: 0 }],
      },
    },
    include: poolInclude,
  });
}

export async function updatePool(
  id: string,
  data: {
    name?: string;
    virtualModelName?: string;
    description?: string;
    routingStrategy?: string;
  },
  members?: Array<{ providerModelId: string; priority?: number }>
) {
  if (members !== undefined) {
    // Replace all members
    await prisma.poolMember.deleteMany({ where: { poolId: id } });
    await prisma.poolMember.createMany({
      data: members.map((m) => ({
        poolId: id,
        providerModelId: m.providerModelId,
        priority: m.priority ?? 0,
      })),
    });
  }

  return prisma.pool.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.virtualModelName !== undefined && { virtualModelName: data.virtualModelName }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.routingStrategy !== undefined && { routingStrategy: data.routingStrategy }),
    },
    include: poolInclude,
  });
}

export async function deletePool(id: string) {
  await prisma.pool.delete({ where: { id } });
}

export async function resolvePool(virtualModelName: string) {
  const pool = await prisma.pool.findUnique({
    where: { virtualModelName },
    include: poolInclude,
  });
  return pool;
}

export async function getPoolByVirtualName(virtualModelName: string) {
  return prisma.pool.findUnique({
    where: { virtualModelName },
  });
}
