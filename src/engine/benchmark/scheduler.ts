// ─── Benchmark Scheduler ───────────────────────────────
// Parallel benchmark execution with per-provider mutex locks.
// Only one key per provider may be in TESTING at a time.

import { prisma } from "@/lib/prisma";
import { getBenchmarkConfig } from "./config";
import { runBenchmark, BenchmarkTarget, BenchmarkResult } from "./runner";

// In-memory provider mutex locks
const providerLocks = new Map<string, boolean>();

// Active benchmark tracking
interface ActiveBenchmark {
  apiKeyId: string;
  providerId: string;
  startedAt: number;
  stage: string;
}

const activeBenchmarks = new Map<string, ActiveBenchmark>();
const queue: BenchmarkTarget[] = [];
let running = false;

export interface SchedulerStatus {
  running: boolean;
  active: ActiveBenchmark[];
  queueLength: number;
  maxParallelTests: number;
}

/**
 * Enqueues a set of keys for benchmarking. Keys belonging to
 * the same provider are serialized via mutex locks.
 */
export async function enqueueBenchmarks(targets: BenchmarkTarget[]): Promise<number> {
  queue.push(...targets);
  // Kick off the scheduler loop if not already running
  if (!running) {
    running = true;
    void runSchedulerLoop();
  }
  return targets.length;
}

async function runSchedulerLoop(): Promise<void> {
  try {
    while (queue.length > 0 || activeBenchmarks.size > 0) {
      const config = await getBenchmarkConfig();
      maxParallelTests = config.maxParallelTests;
      const maxParallel = config.maxParallelTests;

      // Launch as many queued jobs as concurrency allows
      while (
        queue.length > 0 &&
        activeBenchmarks.size < maxParallel
      ) {
        const target = queue.shift()!;
        if (providerLocks.get(target.providerId)) {
          // Provider lock busy — requeue at the end
          queue.push(target);
          break;
        }
        providerLocks.set(target.providerId, true);
        activeBenchmarks.set(target.apiKeyId, {
          apiKeyId: target.apiKeyId,
          providerId: target.providerId,
          startedAt: Date.now(),
          stage: "TTFT",
        });
        void executeBenchmark(target);
      }

      if (activeBenchmarks.size === 0 && queue.length === 0) {
        break;
      }

      await sleep(1000);
    }
  } finally {
    running = false;
  }
}

async function executeBenchmark(target: BenchmarkTarget): Promise<void> {
  try {
    const result = await runBenchmark(target, (stage) => {
      const active = activeBenchmarks.get(target.apiKeyId);
      if (active) active.stage = stage;
    });
    console.error(
      `[benchmark] key=${target.apiKeyId.slice(0, 8)} passed=${result.passed} ` +
      `ttft=${result.ttftMs}ms tps=${result.avgTps.toFixed(1)} throttled=${result.isThrottled}`
    );
  } catch (err) {
    console.error(`[benchmark] key=${target.apiKeyId.slice(0, 8)} error:`, err);
  } finally {
    activeBenchmarks.delete(target.apiKeyId);
    providerLocks.set(target.providerId, false);
  }
}

export function getSchedulerStatus(): SchedulerStatus {
  return {
    running,
    active: Array.from(activeBenchmarks.values()),
    queueLength: queue.length,
    maxParallelTests: maxParallelTests,
  };
}

// Cached concurrency limit (refreshed each scheduler loop iteration)
let maxParallelTests = 3;

/**
 * Builds benchmark targets for all eligible keys (ACTIVE or PENALIZED).
 */
export async function buildBenchmarkTargets(): Promise<BenchmarkTarget[]> {
  const keys = await prisma.apiKey.findMany({
    where: { status: { in: ["ACTIVE", "PENALIZED"] } },
    include: {
      provider: {
        include: {
          providerModels: {
            where: { enabled: true },
            take: 1,
          },
        },
      },
    },
  });

  return keys
    .filter((k) => k.provider.providerModels.length > 0)
    .map((k) => ({
      apiKeyId: k.id,
      providerId: k.providerId,
      providerName: k.provider.name,
      baseUrl: k.provider.baseUrl,
      apiFormat: k.provider.apiFormat,
      modelId: k.provider.providerModels[0].modelId,
      displayName: k.provider.providerModels[0].displayName,
      secret: k.secret ?? "",
    }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
