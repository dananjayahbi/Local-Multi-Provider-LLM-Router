// ─── Request Log Data Access ───────────────────────────

import { prisma } from "@/lib/prisma";

export interface CreateRequestLogInput {
  poolId?: string | null;
  apiKeyId?: string | null;
  providerModelId?: string | null;
  tier?: string | null;
  outcome: string;
  errorClassification?: string | null;
  httpStatus?: number | null;
  latencyMs: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
  requestedVirtualModel: string;
}

export async function createRequestLog(data: CreateRequestLogInput) {
  return prisma.requestLog.create({ data });
}

export interface LogFilters {
  providerId?: string;
  poolId?: string;
  apiKeyId?: string;
  outcome?: string;
  errorClassification?: string;
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  pageSize?: number;
}

export async function getLogs(filters: LogFilters = {}) {
  const { page = 1, pageSize = 50, ...filterCriteria } = filters;
  const where: Record<string, unknown> = {};

  if (filterCriteria.poolId) where.poolId = filterCriteria.poolId;
  if (filterCriteria.outcome) where.outcome = filterCriteria.outcome;
  if (filterCriteria.errorClassification) where.errorClassification = filterCriteria.errorClassification;

  if (filterCriteria.apiKeyId) where.apiKeyId = filterCriteria.apiKeyId;

  if (filterCriteria.providerId) {
    where.apiKey = { providerId: filterCriteria.providerId };
  }

  if (filterCriteria.dateFrom || filterCriteria.dateTo) {
    const createdAt: Record<string, Date> = {};
    if (filterCriteria.dateFrom) createdAt.gte = filterCriteria.dateFrom;
    if (filterCriteria.dateTo) createdAt.lte = filterCriteria.dateTo;
    where.createdAt = createdAt;
  }

  const [logs, total] = await Promise.all([
    prisma.requestLog.findMany({
      where,
      include: {
        apiKey: { select: { id: true, label: true, provider: { select: { name: true } } } },
        pool: { select: { id: true, name: true } },
        providerModel: { select: { id: true, displayName: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.requestLog.count({ where }),
  ]);

  return { logs, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

export async function getDashboardStats() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [
    providerCount,
    keyCount,
    poolCount,
    healthyKeys,
    penalizedKeys,
    suspendedKeys,
    disabledKeys,
    requestsToday,
    failuresToday,
    recentLogs,
  ] = await Promise.all([
    prisma.provider.count(),
    prisma.apiKey.count(),
    prisma.pool.count(),
    prisma.apiKey.count({ where: { status: "ACTIVE" } }),
    prisma.apiKey.count({ where: { status: "PENALIZED" } }),
    prisma.apiKey.count({ where: { status: "SUSPENDED" } }),
    prisma.apiKey.count({ where: { status: "DISABLED" } }),
    prisma.requestLog.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.requestLog.count({
      where: { createdAt: { gte: todayStart }, outcome: "FAILURE" },
    }),
    prisma.requestLog.findMany({
      where: { outcome: "FAILURE" },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        apiKey: { select: { id: true, label: true, provider: { select: { name: true } } } },
        pool: { select: { id: true, name: true } },
      },
    }),
  ]);

  return {
    providerCount,
    keyCount,
    poolCount,
    healthyKeys,
    penalizedKeys,
    suspendedKeys,
    disabledKeys,
    requestsToday,
    failuresToday,
    failureRate: requestsToday > 0 ? ((failuresToday / requestsToday) * 100).toFixed(1) : "0",
    recentFailures: recentLogs,
  };
}

// ─── Usage Stats ────────────────────────────────────────

export interface UsageFilters {
  dateFrom?: Date;
  dateTo?: Date;
  providerId?: string;
  poolId?: string;
  apiKeyId?: string;
}

export interface UsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
  successCount: number;
  failureCount: number;
}

export async function getUsageStats(filters: UsageFilters = {}): Promise<UsageStats> {
  const where: Record<string, unknown> = {};

  if (filters.dateFrom || filters.dateTo) {
    const createdAt: Record<string, Date> = {};
    if (filters.dateFrom) createdAt.gte = filters.dateFrom;
    if (filters.dateTo) createdAt.lte = filters.dateTo;
    where.createdAt = createdAt;
  }

  if (filters.poolId) where.poolId = filters.poolId;
  if (filters.apiKeyId) where.apiKeyId = filters.apiKeyId;

  if (filters.providerId) {
    where.apiKey = { providerId: filters.providerId };
  }

  const [aggregation, requestCount, successCount, failureCount] = await Promise.all([
    prisma.requestLog.aggregate({
      where,
      _sum: {
        promptTokens: true,
        completionTokens: true,
      },
    }),
    prisma.requestLog.count({ where }),
    prisma.requestLog.count({ where: { ...where, outcome: "SUCCESS" } }),
    prisma.requestLog.count({ where: { ...where, outcome: "FAILURE" } }),
  ]);

  return {
    promptTokens: aggregation._sum.promptTokens ?? 0,
    completionTokens: aggregation._sum.completionTokens ?? 0,
    totalTokens: (aggregation._sum.promptTokens ?? 0) + (aggregation._sum.completionTokens ?? 0),
    requestCount,
    successCount,
    failureCount,
  };
}
