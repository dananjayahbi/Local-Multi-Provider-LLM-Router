import { NextRequest, NextResponse } from "next/server";
import { getLogs, getDashboardStats } from "@/engine/data-access/request-logs";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const stats = searchParams.get("stats");

    if (stats === "true") {
      const dashboardStats = await getDashboardStats();
      return NextResponse.json(dashboardStats);
    }

    const filters = {
      providerId: searchParams.get("providerId") || undefined,
      poolId: searchParams.get("poolId") || undefined,
      apiKeyId: searchParams.get("apiKeyId") || undefined,
      outcome: searchParams.get("outcome") || undefined,
      errorClassification: searchParams.get("errorClassification") || undefined,
      dateFrom: searchParams.get("dateFrom") ? new Date(searchParams.get("dateFrom")!) : undefined,
      dateTo: searchParams.get("dateTo") ? new Date(searchParams.get("dateTo")!) : undefined,
      page: searchParams.get("page") ? parseInt(searchParams.get("page")!) : 1,
      pageSize: searchParams.get("pageSize") ? parseInt(searchParams.get("pageSize")!) : 50,
    };

    const result = await getLogs(filters);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
