// ─── Rate-Limit Catalog API ─────────────────────────────
// GET /api/admin/rate-limits/catalog
// Returns the full catalog of API keys the /usage page can chart, each with:
//   - its provider name + pool memberships
//   - the count of requests (success + failure) in the past hour, used to
//     auto-select the "most used 2 keys" by default.
// The client uses this to seed chart selection without opening a separate DB
// query per key.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export interface CatalogKey {
  id: string;
  label: string;
  providerName: string;
  poolIds: string[];
  poolNames: string[];
  rpmLimit: number | null;
  tpmLimit: number | null;
  rpdLimit: number | null;
  tpdLimit: number | null;
  /** Total RequestLog rows in the last hour for this key (any outcome). */
  requestsLastHour: number;
  /** Whether this key has any rate/token limit configured. */
  hasLimits: boolean;
}

export async function GET() {
  try {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const keys = await prisma.apiKey.findMany({
      select: {
        id: true,
        label: true,
        rpmLimit: true,
        tpmLimit: true,
        rpdLimit: true,
        tpdLimit: true,
        provider: { select: { name: true } },
        poolApiKeys: { select: { pool: { select: { id: true, name: true } } } },
        requestLogs: {
          where: { createdAt: { gte: hourAgo } },
          select: { id: true },
        },
      },
      orderBy: { label: "asc" },
    });

    const catalog: CatalogKey[] = keys.map((k) => ({
      id: k.id,
      label: k.label,
      providerName: k.provider.name,
      poolIds: k.poolApiKeys.map((j) => j.pool.id),
      poolNames: k.poolApiKeys.map((j) => j.pool.name),
      rpmLimit: k.rpmLimit,
      tpmLimit: k.tpmLimit,
      rpdLimit: k.rpdLimit,
      tpdLimit: k.tpdLimit,
      requestsLastHour: k.requestLogs.length,
      hasLimits: Boolean(
        (k.rpmLimit && k.rpmLimit > 0) ||
        (k.tpmLimit && k.tpmLimit > 0) ||
        (k.rpdLimit && k.rpdLimit > 0) ||
        (k.tpdLimit && k.tpdLimit > 0)
      ),
    }));

    return NextResponse.json(catalog);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
