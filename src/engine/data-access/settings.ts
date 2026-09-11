// ─── App Settings Data Access ──────────────────────────

import { prisma } from "@/lib/prisma";
import { generateGatewayKey } from "@/lib/gateway-key";

const DEFAULT_SETTINGS = {
  penaltyBaseCooldownSeconds: 600,
  penaltyMultiplier: 3,
  penaltyMaxCooldownSeconds: 21600,
  penaltyResetWindowSeconds: 3600,
};

export async function getAppSettings() {
  let settings = await prisma.appSettings.findUnique({ where: { id: "singleton" } });
  if (!settings) {
    settings = await initializeAppSettings();
  }
  return settings;
}

export async function updateAppSettings(data: {
  unifiedGatewayKeyHash?: string;
  unifiedGatewayKeyPrefix?: string;
  penaltyBaseCooldownSeconds?: number;
  penaltyMultiplier?: number;
  penaltyMaxCooldownSeconds?: number;
  penaltyResetWindowSeconds?: number;
}) {
  return prisma.appSettings.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      ...DEFAULT_SETTINGS,
      ...data,
      unifiedGatewayKeyHash: data.unifiedGatewayKeyHash || "",
      unifiedGatewayKeyPrefix: data.unifiedGatewayKeyPrefix || "",
    },
    update: data,
  });
}

// Return type is inferred as `AppSettings & { plaintextKey: string }` so it
// always stays in sync with the Prisma model (a hand-written annotation went
// stale when the deprecated `compactionEnabled` column existed in the schema
// but not in the annotation, breaking assignment + null-narrowing downstream).
export async function initializeAppSettings() {
  const existing = await prisma.appSettings.findUnique({ where: { id: "singleton" } });
  if (existing) {
    return { ...existing, plaintextKey: "" };
  }

  const { plaintext, hash, prefix } = generateGatewayKey();
  const settings = await prisma.appSettings.create({
    data: {
      id: "singleton",
      unifiedGatewayKeyHash: hash,
      unifiedGatewayKeyPrefix: prefix,
      ...DEFAULT_SETTINGS,
    },
  });

  return { ...settings, plaintextKey: plaintext };
}

export async function regenerateGatewayKey() {
  const { plaintext, hash, prefix } = generateGatewayKey();
  await prisma.appSettings.update({
    where: { id: "singleton" },
    data: {
      unifiedGatewayKeyHash: hash,
      unifiedGatewayKeyPrefix: prefix,
    },
  });
  return { plaintext, prefix };
}
