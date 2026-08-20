// ─── Pool Data Access ──────────────────────────────────
// Keys now belong to the POOL (pool.apiKeys), not the provider.
// Each pool also owns a plaintext gateway key (always copyable).

import { prisma } from "@/lib/prisma";
import { generateGatewayKey } from "@/lib/gateway-key";

const poolInclude = {
  poolMembers: {
    include: {
      providerModel: {
        include: {
          provider: {
            select: {
              id: true,
              name: true,
              baseUrl: true,
              apiFormat: true,
            },
          },
        },
      },
    },
  },
  apiKeys: {
    include: {
      provider: {
        select: { id: true, name: true, baseUrl: true, apiFormat: true },
      },
    },
    orderBy: { createdAt: "asc" as const },
  },
  _count: { select: { poolMembers: true } },
};

export async function getAllPools() {
  const pools = await prisma.pool.findMany({
    include: {
      poolMembers: {
        include: {
          providerModel: { include: { provider: { select: { id: true, name: true } } } },
        },
      },
      apiKeys: { select: { id: true, status: true } },
      _count: { select: { poolMembers: true } },
    },
    orderBy: { name: "asc" },
  });

  return pools.map((p) => {
    const allKeys = p.apiKeys;
    const healthy = allKeys.filter((k) => k.status === "ACTIVE").length;
    const total = allKeys.length;
    const { apiKeys, ...rest } = p;
    return { ...rest, healthyKeys: healthy, totalKeys: total };
  });
}

export async function getPoolById(id: string) {
  return prisma.pool.findUnique({
    where: { id },
    include: poolInclude,
  });
}

function newGatewayKey() {
  const { plaintext, prefix } = generateGatewayKey();
  return { gatewayKey: plaintext, gatewayKeyPrefix: prefix };
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
  const gw = newGatewayKey();
  return prisma.pool.create({
    data: {
      name: data.name,
      virtualModelName: data.virtualModelName,
      description: data.description,
      routingStrategy: data.routingStrategy ?? "KEY_AWARE",
      ...gw,
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

  const gw = newGatewayKey();
  return prisma.pool.create({
    data: {
      name: `Pool: ${model.provider.name} / ${model.displayName}`,
      virtualModelName,
      description: `Quick pool for ${model.provider.name} → ${model.displayName}`,
      routingStrategy: "KEY_AWARE",
      ...gw,
      poolMembers: {
        create: [{ providerModelId, priority: 0 }],
      },
    },
    include: poolInclude,
  });
}

export async function regeneratePoolGatewayKey(id: string) {
  const gw = newGatewayKey();
  return prisma.pool.update({
    where: { id },
    data: gw,
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
    cacheAware?: boolean;
    stickyContextTokenBudget?: number;
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
      ...(data.cacheAware !== undefined && { cacheAware: data.cacheAware }),
      ...(data.stickyContextTokenBudget !== undefined && {
        stickyContextTokenBudget: data.stickyContextTokenBudget,
      }),
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
