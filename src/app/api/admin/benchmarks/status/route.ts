import { NextResponse } from "next/server";
import { getSchedulerStatus } from "@/engine/benchmark/scheduler";
import { getThrottleMatrix } from "@/engine/data-access/benchmarks";
import { getBenchmarkConfig } from "@/engine/benchmark/config";

export async function GET() {
  try {
    const [status, matrix, config] = await Promise.all([
      getSchedulerStatus(),
      getThrottleMatrix(),
      getBenchmarkConfig(),
    ]);
    return NextResponse.json({ status, matrix, config });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
