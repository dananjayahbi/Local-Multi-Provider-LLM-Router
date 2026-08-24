// ─── Backup Engine: Export ──────────────────────────────
// Builds a versioned JSON snapshot of the router's CONFIGURATION.
// Captures: providers, api keys, provider models, pools, pool-api-key
// joins, pool members, app settings, benchmark config.
// Excludes transient runtime data (logs, sessions, benchmarks).

import { prisma } from "@/lib/prisma";
import type { BackupPayload } from "./types";

const BACKUP_VERSION = 1;

export async function createBackup(): Promise<BackupPayload> {
  const [
    providers,
    apiKeys,
    providerModels,
    pools,
    poolApiKeys,
    poolMembers,
    appSettings,
    benchmarkConfig,
  ] = await Promise.all([
    prisma.provider.findMany(),
    prisma.apiKey.findMany(),
    prisma.providerModel.findMany(),
    prisma.pool.findMany(),
    prisma.poolApiKey.findMany(),
    prisma.poolMember.findMany(),
    prisma.appSettings.findUnique({ where: { id: "singleton" } }),
    prisma.benchmarkConfig.findUnique({ where: { id: "singleton" } }),
  ]);

  return {
    meta: {
      app: "local-multi-provider-llm-router",
      version: BACKUP_VERSION,
      createdAt: new Date().toISOString(),
      counts: {
        providers: providers.length,
        apiKeys: apiKeys.length,
        providerModels: providerModels.length,
        pools: pools.length,
        poolApiKeys: poolApiKeys.length,
        poolMembers: poolMembers.length,
        appSettings: appSettings ? 1 : 0,
        benchmarkConfig: benchmarkConfig ? 1 : 0,
      },
    },
    providers,
    apiKeys,
    providerModels,
    pools,
    poolApiKeys,
    poolMembers,
    appSettings,
    benchmarkConfig,
  };
}

/** Serialize a backup payload to a pretty-printed JSON string. */
export function serializeBackup(payload: BackupPayload): string {
  return JSON.stringify(payload, null, 2);
}
