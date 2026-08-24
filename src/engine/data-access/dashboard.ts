// ─── Dashboard Data Access ─────────────────────────────
// Aggregated "today" stats + the penalty-inspector feed for the /dashboard
// overhaul. Kept separate from request-logs so the dashboard can evolve
// without disturbing the /logs page.

import { prisma } from "@/lib/prisma";

// ─── Today's tokens + requests ─────────────────────────

export interface TodayTokens {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface TodayRequests {
  total: number;
  success: number;
  failed: number;
}

function todayStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Today's token usage (prompt / completion / total) and request counts. */
export async function getTodayUsage(): Promise<{ tokens: TodayTokens; requests: TodayRequests }> {
  const start = todayStart();
  const where = { createdAt: { gte: start } };

  const [agg, total, success, failed] = await Promise.all([
    prisma.requestLog.aggregate({
      where,
      _sum: { promptTokens: true, completionTokens: true },
    }),
    prisma.requestLog.count({ where }),
    prisma.requestLog.count({ where: { ...where, outcome: "SUCCESS" } }),
    prisma.requestLog.count({ where: { ...where, outcome: "FAILURE" } }),
  ]);

  const prompt = agg._sum.promptTokens ?? 0;
  const completion = agg._sum.completionTokens ?? 0;

  return {
    tokens: { promptTokens: prompt, completionTokens: completion, totalTokens: prompt + completion },
    requests: { total, success, failed },
  };
}

// ─── Penalty inspector feed ────────────────────────────

export interface PenalizedKeyRow {
  id: string;
  label: string;
  status: string;
  penaltyLevel: number;
  penaltyType: string | null;
  penaltyReason: string | null;
  penaltyExpiresAt: Date | null;
  providerId: string;
  providerName: string;
  /** Provider model(s) this key is bound to (flattened, deduped). */
  models: string[];
  poolNames: string[];
}

export interface PenaltyFilters {
  providerId?: string;
  /** Filter by model id (a key matches if it is bound to this model). */
  modelId?: string;
}

/**
 * Penalized (and suspended) keys ordered by most-recently-penalized first.
 * Suspended keys are included since they often follow a penalty and the admin
 * may want to reset them the same way.
 */
export async function getPenaltyFeed(filters: PenaltyFilters = {}): Promise<PenalizedKeyRow[]> {
  // Order by most recently applied penalty first. We approximate "recently
  // applied" by penalty expiry minus its cooldown; simplest robust proxy is
  // `updatedAt` desc (penalty state changes bump updatedAt). We key on the
  // penalty fields being set.
  const keys = await prisma.apiKey.findMany({
    where: {
      NOT: [{ penaltyLevel: 0 }],
      status: { in: ["PENALIZED", "SUSPENDED"] },
      ...(filters.providerId ? { providerId: filters.providerId } : {}),
    },
    select: {
      id: true,
      label: true,
      status: true,
      penaltyLevel: true,
      penaltyType: true,
      penaltyReason: true,
      penaltyExpiresAt: true,
      providerId: true,
      provider: { select: { name: true } },
      poolApiKeys: {
        select: {
          pool: {
            select: {
              name: true,
              poolMembers: { select: { providerModelId: true } },
            },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  // Resolve model display names for any providerModelId referenced.
  const modelIdSet = new Set<string>();
  for (const k of keys) {
    for (const join of k.poolApiKeys) {
      for (const m of join.pool.poolMembers) modelIdSet.add(m.providerModelId);
    }
  }
  const models = await prisma.providerModel.findMany({
    where: { id: { in: Array.from(modelIdSet) } },
    select: { id: true, displayName: true },
  });
  const modelNameById = new Map(models.map((m) => [m.id, m.displayName]));

  const rows: PenalizedKeyRow[] = keys.map((k) => {
    const modelsForKey = Array.from(
      new Set(
        k.poolApiKeys.flatMap((join) =>
          join.pool.poolMembers.map((m) => modelNameById.get(m.providerModelId) ?? m.providerModelId)
        )
      )
    );
    return {
      id: k.id,
      label: k.label,
      status: k.status,
      penaltyLevel: k.penaltyLevel,
      penaltyType: k.penaltyType,
      penaltyReason: k.penaltyReason,
      penaltyExpiresAt: k.penaltyExpiresAt,
      providerId: k.providerId,
      providerName: k.provider.name,
      models: modelsForKey,
      poolNames: k.poolApiKeys.map((j) => j.pool.name),
    };
  });

  return filters.modelId ? rows.filter((k) => k.models.includes(filters.modelId!)) : rows;
}
