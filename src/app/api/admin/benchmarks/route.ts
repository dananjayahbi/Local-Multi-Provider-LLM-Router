import { NextRequest, NextResponse } from "next/server";
import { getBenchmarks } from "@/engine/data-access/benchmarks";
import { buildBenchmarkTargets, enqueueBenchmarks } from "@/engine/benchmark/scheduler";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const apiKeyId = searchParams.get("apiKeyId") ?? undefined;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!) : undefined;
    const benchmarks = await getBenchmarks({ apiKeyId, limit });
    return NextResponse.json(benchmarks);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * POST /api/admin/benchmarks
 * Body: { apiKeyId?: string } — if provided, benchmarks a single key.
 *       If omitted, benchmarks all eligible keys.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    let targets;
    if (body.apiKeyId) {
      const all = await buildBenchmarkTargets();
      targets = all.filter((t) => t.apiKeyId === body.apiKeyId);
      if (targets.length === 0) {
        return NextResponse.json(
          { error: "Key not found or not eligible for benchmarking" },
          { status: 404 }
        );
      }
    } else {
      targets = await buildBenchmarkTargets();
    }

    const enqueued = await enqueueBenchmarks(targets);
    return NextResponse.json({ enqueued, total: targets.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
