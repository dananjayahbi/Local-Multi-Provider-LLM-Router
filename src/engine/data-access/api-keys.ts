// ─── API Key Data Access ───────────────────────────────
// Keys are now PROVIDER-LEVEL credentials (owned by a provider) that can be
// SHARED across multiple pools via the PoolApiKey join table (task 05).
// Penalties/limits live on the ApiKey, so sharing propagates penalty to every
// pool using the key. Secrets stored in PLAINTEXT (always copyable).
// `secretEncrypted` is kept for backward-compat reads; new writes use `secret`.

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
  autoCalibration?: boolean;
}

export async function getKeysByProvider(providerId: string) {
  return prisma.apiKey.findMany({
    where: { providerId },
    orderBy: { createdAt: "asc" },
    include: {
      poolApiKeys: { select: { poolId: true } },
    },
  });
}

export async function getKeyById(id: string) {
  return prisma.apiKey.findUnique({ where: { id } });
}

/** All provider-level keys (used by pool key editor to attach shared keys). */
export async function getAllKeys() {
  await ensurePoolKeyBackfill();
  return prisma.apiKey.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      provider: { select: { id: true, name: true, baseUrl: true, apiFormat: true } },
      poolApiKeys: { select: { poolId: true } },
    },
  });
}

/** Keys attached to a pool via the PoolApiKey join. */
export async function getKeysByPool(poolId: string) {
  const joins = await prisma.poolApiKey.findMany({
    where: { poolId },
    include: {
      apiKey: {
        include: {
          provider: { select: { id: true, name: true, baseUrl: true, apiFormat: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  return joins.map((j) => j.apiKey);
}

export async function createApiKey(
  providerId: string,
  data: ApiKeyInput & { poolId?: string | null }
) {
  return prisma.apiKey.create({
    data: {
      poolId: null, // provider-level; pool association goes through PoolApiKey
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
      autoCalibration: data.autoCalibration ?? false,
    },
  });
}

export async function updateApiKey(id: string, data: Partial<ApiKeyInput>) {
  const updateData: Record<string, unknown> = {};
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
  if (data.autoCalibration !== undefined) updateData.autoCalibration = data.autoCalibration;
  return prisma.apiKey.update({ where: { id }, data: updateData });
}

export async function deleteApiKey(id: string) {
  await prisma.apiKey.delete({ where: { id } });
}

// ─── Pool ↔ Key attachment (PoolApiKey join) ───────────

export async function addKeyToPool(poolId: string, apiKeyId: string) {
  const existing = await prisma.poolApiKey.findUnique({
    where: { poolId_apiKeyId: { poolId, apiKeyId } },
  });
  if (existing) return existing;
  return prisma.poolApiKey.create({ data: { poolId, apiKeyId } });
}

export async function removeKeyFromPool(poolId: string, apiKeyId: string) {
  await prisma.poolApiKey.deleteMany({ where: { poolId, apiKeyId } });
}

// ─── Legacy backfill ──────────────────────────────────
// Migrate pool-owned keys (ApiKey.poolId) into PoolApiKey join rows so keys
// become provider-level and shareable across pools. Idempotent.
export async function backfillPoolKeys(): Promise<number> {
  const legacyKeys = await prisma.apiKey.findMany({
    where: { poolId: { not: null } },
    select: { id: true, poolId: true },
  });
  let count = 0;
  for (const k of legacyKeys) {
    if (!k.poolId) continue;
    const existing = await prisma.poolApiKey.findUnique({
      where: { poolId_apiKeyId: { poolId: k.poolId, apiKeyId: k.id } },
    });
    if (!existing) {
      await prisma.poolApiKey.create({ data: { poolId: k.poolId, apiKeyId: k.id } });
      count++;
    }
    await prisma.apiKey.update({ where: { id: k.id }, data: { poolId: null } });
  }
  return count;
}

// Idempotent on-demand backfill guard. Called from discovery/pool entry points
// since runStartup() is not wired into the Next.js server lifecycle.
let poolKeyBackfillDone = false;
export async function ensurePoolKeyBackfill(): Promise<void> {
  if (poolKeyBackfillDone) return;
  await backfillPoolKeys();
  poolKeyBackfillDone = true;
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
