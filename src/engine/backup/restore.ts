// ─── Backup Engine: Restore ─────────────────────────────
// Applies a previously-exported configuration snapshot back to
// the database. Supports two modes:
//   "merge"   — upsert every record by id; records NOT present in the
//               backup are left untouched (ideal for partial restores).
//   "replace" — wipe the entire config domain first, then insert the
//               snapshot (ideal for a full rollback to a known state).
// Insertion is ordered to respect foreign keys (providers → keys/models →
// pools → joins → singletons). The whole operation runs in a transaction.

import { prisma } from "@/lib/prisma";
import type { BackupPayload } from "./types";

export type RestoreMode = "merge" | "replace";

export interface RestoreResult {
  mode: RestoreMode;
  counts: BackupPayload["meta"]["counts"];
}

async function validatePayload(payload: BackupPayload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid backup payload");
  }
  if (!Array.isArray(payload.providers)) throw new Error("Backup missing 'providers'");
  if (!Array.isArray(payload.apiKeys)) throw new Error("Backup missing 'apiKeys'");
  if (!Array.isArray(payload.providerModels)) throw new Error("Backup missing 'providerModels'");
  if (!Array.isArray(payload.pools)) throw new Error("Backup missing 'pools'");
  if (!Array.isArray(payload.poolApiKeys)) throw new Error("Backup missing 'poolApiKeys'");
  if (!Array.isArray(payload.poolMembers)) throw new Error("Backup missing 'poolMembers'");
}

/** Delete all config-domain data in dependency-safe order. */
async function clearConfigDomain(tx: {
  poolMember: { deleteMany: (a: unknown) => Promise<unknown> };
  poolApiKey: { deleteMany: (a: unknown) => Promise<unknown> };
  pool: { deleteMany: (a: unknown) => Promise<unknown> };
  apiKey: { deleteMany: (a: unknown) => Promise<unknown> };
  providerModel: { deleteMany: (a: unknown) => Promise<unknown> };
  provider: { deleteMany: (a: unknown) => Promise<unknown> };
  appSettings: { deleteMany: (a: unknown) => Promise<unknown> };
  benchmarkConfig: { deleteMany: (a: unknown) => Promise<unknown> };
}) {
  // Join + child tables first, then parents.
  await tx.poolMember.deleteMany({});
  await tx.poolApiKey.deleteMany({});
  await tx.pool.deleteMany({});
  await tx.apiKey.deleteMany({});
  await tx.providerModel.deleteMany({});
  await tx.provider.deleteMany({});
  await tx.appSettings.deleteMany({});
  await tx.benchmarkConfig.deleteMany({});
}

/** Upsert the singleton config rows (appSettings, benchmarkConfig). */
async function upsertSingletons(
  tx: any,
  payload: BackupPayload,
  mode: RestoreMode
) {
  if (payload.appSettings) {
    await tx.appSettings.upsert({
      where: { id: payload.appSettings.id },
      create: payload.appSettings,
      update: payload.appSettings,
    });
  } else if (mode === "replace") {
    // No app settings in backup; leave fresh defaults on a replace.
    // getAppSettings() lazily initializes when absent.
  }

  if (payload.benchmarkConfig) {
    await tx.benchmarkConfig.upsert({
      where: { id: payload.benchmarkConfig.id },
      create: payload.benchmarkConfig,
      update: payload.benchmarkConfig,
    });
  }
}

export async function restoreBackup(payload: BackupPayload, mode: RestoreMode = "merge"): Promise<RestoreResult> {
  await validatePayload(payload);

  await prisma.$transaction(async (tx) => {
    if (mode === "replace") {
      await clearConfigDomain(tx as any);
    }

    // 1. Providers (no inbound FK besides draftProvider relation, which is
    //    optional and references DraftProvider — left intact).
    for (const p of payload.providers) {
      await tx.provider.upsert({
        where: { id: p.id },
        create: p,
        update: p,
      });
    }

    // 2. API keys (FK → provider).
    for (const k of payload.apiKeys) {
      await tx.apiKey.upsert({
        where: { id: k.id },
        create: k,
        update: k,
      });
    }

    // 3. Provider models (FK → provider).
    for (const m of payload.providerModels) {
      await tx.providerModel.upsert({
        where: { id: m.id },
        create: m,
        update: m,
      });
    }

    // 4. Pools (FK → none directly).
    for (const po of payload.pools) {
      await tx.pool.upsert({
        where: { id: po.id },
        create: po,
        update: po,
      });
    }

    // 5. PoolApiKey joins (FK → pool + apiKey).
    for (const j of payload.poolApiKeys) {
      await tx.poolApiKey.upsert({
        where: { id: j.id },
        create: j,
        update: j,
      });
    }

    // 6. PoolMembers (FK → pool + providerModel).
    for (const pm of payload.poolMembers) {
      await tx.poolMember.upsert({
        where: { id: pm.id },
        create: pm,
        update: pm,
      });
    }

    // 7. Singletons.
    await upsertSingletons(tx, payload, mode);
  });

  return {
    mode,
    counts: payload.meta.counts,
  };
}
