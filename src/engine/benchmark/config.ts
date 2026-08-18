// ─── Benchmark Config Data Access ──────────────────────
// Singleton table storing benchmarking rules and throttle limits.

import { prisma } from "@/lib/prisma";

const DEFAULT_CONFIG = {
  baselineProviderModelId: null as string | null,
  targetTps: 60.0,
  targetRpm: 15,
  ttftDriftThreshold: 2.5,
  tpsDriftThreshold: 2.0,
  postTestCooldownSeconds: 120,
  maxParallelTests: 3,
};

export interface BenchmarkConfigData {
  baselineProviderModelId: string | null;
  targetTps: number;
  targetRpm: number;
  ttftDriftThreshold: number;
  tpsDriftThreshold: number;
  postTestCooldownSeconds: number;
  maxParallelTests: number;
}

export async function getBenchmarkConfig(): Promise<BenchmarkConfigData> {
  let config = await prisma.benchmarkConfig.findUnique({ where: { id: "singleton" } });
  if (!config) {
    config = await prisma.benchmarkConfig.create({
      data: { id: "singleton", ...DEFAULT_CONFIG },
    });
  }
  return {
    baselineProviderModelId: config.baselineProviderModelId,
    targetTps: config.targetTps,
    targetRpm: config.targetRpm,
    ttftDriftThreshold: config.ttftDriftThreshold,
    tpsDriftThreshold: config.tpsDriftThreshold,
    postTestCooldownSeconds: config.postTestCooldownSeconds,
    maxParallelTests: config.maxParallelTests,
  };
}

export async function updateBenchmarkConfig(data: Partial<BenchmarkConfigData>) {
  return prisma.benchmarkConfig.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...DEFAULT_CONFIG, ...data },
    update: data,
  });
}
