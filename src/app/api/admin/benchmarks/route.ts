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
 * Body: { apiKeyId?: string, apiKeyIds?: string[] }
 *   - apiKeyIds: benchmarks the selected keys (one or many).
 *   - apiKeyId:  benchmarks a single key (backward compat).
 *   - omitted:   benchmarks all eligible keys.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    const selectedIds: string[] = Array.isArray(body.apiKeyIds)
      ? body.apiKeyIds
      : body.apiKeyId
        ? [body.apiKeyId]
        : [];

    let targets;
    if (selectedIds.length > 0) {
      const all = await buildBenchmarkTargets();
      const selected = new Set(selectedIds);
      targets = all.filter((t) => selected.has(t.apiKeyId));
      if (targets.length === 0) {
        return NextResponse.json(
          { error: "No selected keys found or eligible for benchmarking" },
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
