// ─── API Key Data Access ───────────────────────────────
// Keys now belong to a pool (poolId) + provider, carry their own
// rate/token/cache limits, and store the secret in PLAINTEXT
// (local single-user → always copyable). `secretEncrypted` is kept
// for backward-compat reads; new writes use `secret`.

import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";

export interface ApiKeyInput {
  label: string;
  secret: string;
  rpmLimit: number | null;
  tpmLimit: number | null;
  rpdLimit?: number | null;
  tpdLimit?: number | null;
  tps?: number | null;
  timeToFirstTokenMs?: number | null;
  contextWindow?: number | null;
  cacheCapable?: boolean;
  cacheDiscountFactor?: number;
}

export async function getKeysByProvider(providerId: string) {
  return prisma.apiKey.findMany({
    where: { providerId },
    orderBy: { createdAt: "asc" },
  });
}

export async function getKeysByPool(poolId: string) {
  return prisma.apiKey.findMany({
    where: { poolId },
    orderBy: { createdAt: "asc" },
    include: {
      provider: { select: { id: true, name: true, baseUrl: true, apiFormat: true } },
    },
  });
}

export async function getKeyById(id: string) {
  return prisma.apiKey.findUnique({ where: { id } });
}

export async function createApiKey(
  providerId: string,
  data: ApiKeyInput & { poolId?: string | null }
) {
  return prisma.apiKey.create({
    data: {
      poolId: data.poolId ?? null,
      providerId,
      label: data.label,
      secret: data.secret,
      rpmLimit: data.rpmLimit,
      tpmLimit: data.tpmLimit,
      rpdLimit: data.rpdLimit ?? null,
      tpdLimit: data.tpdLimit ?? null,
      tps: data.tps ?? null,
      timeToFirstTokenMs: data.timeToFirstTokenMs ?? null,
      contextWindow: data.contextWindow ?? null,
      cacheCapable: data.cacheCapable ?? true,
      cacheDiscountFactor: data.cacheDiscountFactor ?? 0.1,
    },
  });
}

export async function updateApiKey(id: string, data: Partial<ApiKeyInput> & { poolId?: string | null }) {
  const updateData: Record<string, unknown> = {};
  if (data.poolId !== undefined) updateData.poolId = data.poolId;
  if (data.label !== undefined) updateData.label = data.label;
  if (data.secret !== undefined) updateData.secret = data.secret;
  if (data.rpmLimit !== undefined) updateData.rpmLimit = data.rpmLimit;
  if (data.tpmLimit !== undefined) updateData.tpmLimit = data.tpmLimit;
  if (data.rpdLimit !== undefined) updateData.rpdLimit = data.rpdLimit;
  if (data.tpdLimit !== undefined) updateData.tpdLimit = data.tpdLimit;
  if (data.tps !== undefined) updateData.tps = data.tps;
  if (data.timeToFirstTokenMs !== undefined) updateData.timeToFirstTokenMs = data.timeToFirstTokenMs;
  if (data.contextWindow !== undefined) updateData.contextWindow = data.contextWindow;
  if (data.cacheCapable !== undefined) updateData.cacheCapable = data.cacheCapable;
  if (data.cacheDiscountFactor !== undefined) updateData.cacheDiscountFactor = data.cacheDiscountFactor;
  return prisma.apiKey.update({ where: { id }, data: updateData });
}

export async function deleteApiKey(id: string) {
  await prisma.apiKey.delete({ where: { id } });
}

// ─── Legacy decryption backfill ────────────────────────
// For keys created before plaintext secrets, decrypt secretEncrypted
// into `secret` once. Uses the app encryption key.
export async function backfillPlaintextSecrets(): Promise<number> {
  const keys = await prisma.apiKey.findMany({
    where: { secret: null, secretEncrypted: { not: null } },
    select: { id: true, secretEncrypted: true },
  });
  let count = 0;
  for (const k of keys) {
    if (!k.secretEncrypted) continue;
    try {
      const plain = decrypt(k.secretEncrypted);
      await prisma.apiKey.update({ where: { id: k.id }, data: { secret: plain } });
      count++;
    } catch {
      // leave as-is; encryption key may be unavailable
    }
  }
  return count;
}
