// ─── ApiKeyBenchmark Data Access ───────────────────────

import { prisma } from "@/lib/prisma";

export interface CreateBenchmarkInput {
  apiKeyId: string;
  ttftMs: number;
  avgTps: number;
  latencyDriftRatio: number;
  isThrottled: boolean;
  passed: boolean;
  failureReason?: string | null;
}

export async function createBenchmark(data: CreateBenchmarkInput) {
  return prisma.apiKeyBenchmark.create({ data });
}

export async function getBenchmarks(filters: { apiKeyId?: string; limit?: number } = {}) {
  return prisma.apiKeyBenchmark.findMany({
    where: filters.apiKeyId ? { apiKeyId: filters.apiKeyId } : undefined,
    include: {
      apiKey: {
        select: {
          id: true,
          label: true,
          provider: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { testedAt: "desc" },
    take: filters.limit ?? 100,
  });
}

export async function getLatestBenchmark(apiKeyId: string) {
  return prisma.apiKeyBenchmark.findFirst({
    where: { apiKeyId },
    orderBy: { testedAt: "desc" },
  });
}

/**
 * Builds a throttle analytics matrix comparing all keys'
 * latest benchmark drift ratios against the baseline.
 */
export async function getThrottleMatrix() {
  const keys = await prisma.apiKey.findMany({
    include: {
      provider: { select: { id: true, name: true } },
      benchmarks: {
        orderBy: { testedAt: "desc" },
        take: 1,
      },
    },
  });

  return keys.map((key) => ({
    apiKeyId: key.id,
    apiKeyLabel: key.label,
    providerName: key.provider.name,
    status: key.status,
    latestBenchmark: key.benchmarks[0] ?? null,
  }));
}
