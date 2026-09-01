import { NextRequest, NextResponse } from "next/server";
import { getAppSettings, updateAppSettings, regenerateGatewayKey } from "@/engine/data-access/settings";
import { getBenchmarkConfig, updateBenchmarkConfig } from "@/engine/benchmark/config";

export async function GET() {
  try {
    const [settings, benchmarkConfig] = await Promise.all([
      getAppSettings(),
      getBenchmarkConfig(),
    ]);
    // Don't expose the full hash to the client
    return NextResponse.json({
      gatewayKeyPrefix: settings.unifiedGatewayKeyPrefix,
      penaltyBaseCooldownSeconds: settings.penaltyBaseCooldownSeconds,
      penaltyMultiplier: settings.penaltyMultiplier,
      penaltyMaxCooldownSeconds: settings.penaltyMaxCooldownSeconds,
      penaltyResetWindowSeconds: settings.penaltyResetWindowSeconds,
      benchmark: benchmarkConfig,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    // Handle gateway key regeneration
    if (body.action === "regenerate-key") {
      const { plaintext, prefix } = await regenerateGatewayKey();
      return NextResponse.json({ plaintextKey: plaintext, gatewayKeyPrefix: prefix });
    }

    // Handle benchmark config update
    if (body.benchmark) {
      const benchmarkConfig = await updateBenchmarkConfig({
        baselineProviderModelId: body.benchmark.baselineProviderModelId ?? null,
        targetTps: body.benchmark.targetTps,
        targetRpm: body.benchmark.targetRpm,
        ttftDriftThreshold: body.benchmark.ttftDriftThreshold,
        tpsDriftThreshold: body.benchmark.tpsDriftThreshold,
        postTestCooldownSeconds: body.benchmark.postTestCooldownSeconds,
        maxParallelTests: body.benchmark.maxParallelTests,
      });
      return NextResponse.json({ benchmark: benchmarkConfig });
    }

    // Handle settings update
    const settings = await updateAppSettings({
      penaltyBaseCooldownSeconds: body.penaltyBaseCooldownSeconds,
      penaltyMultiplier: body.penaltyMultiplier,
      penaltyMaxCooldownSeconds: body.penaltyMaxCooldownSeconds,
      penaltyResetWindowSeconds: body.penaltyResetWindowSeconds,
    });
    return NextResponse.json(settings);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
