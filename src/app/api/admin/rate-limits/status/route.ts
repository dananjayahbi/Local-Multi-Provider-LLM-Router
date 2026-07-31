// ─── Rate Limits Status API ────────────────────────────
// GET /api/admin/rate-limits/status
// Returns live RPM/TPM snapshots from the in-memory rate limiter.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAllKeyRateSnapshots, getKeyRateSnapshot } from "@/engine/rate-limit/api-key-rate-limiter";

export interface RateLimitEntry {
  apiKeyId: string;
  apiKeyLabel: string;
  providerName: string;
  rpmCurrent: number;
  rpmLimit: number | null;
  tpmCurrent: number;
  tpmLimit: number | null;
  isWaiting: boolean;
  waitingCount: number;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const poolId = searchParams.get("poolId") || undefined;
    const apiKeyId = searchParams.get("apiKeyId") || undefined;

    if (apiKeyId) {
      // Single key mode
      const snapshot = getKeyRateSnapshot(apiKeyId);
      const key = await prisma.apiKey.findUnique({
        where: { id: apiKeyId },
        select: { label: true, rpmLimit: true, tpmLimit: true, provider: { select: { name: true } } },
      });

      if (!key) {
        return NextResponse.json([]);
      }

      return NextResponse.json([
        {
          apiKeyId,
          apiKeyLabel: key.label,
          providerName: key.provider.name,
          rpmCurrent: snapshot?.rpmCurrent ?? 0,
          rpmLimit: key.rpmLimit,
          tpmCurrent: snapshot?.tpmCurrent ?? 0,
          tpmLimit: key.tpmLimit,
          isWaiting: snapshot?.isWaiting ?? false,
          waitingCount: snapshot?.waitingCount ?? 0,
        },
      ]);
    }

    if (poolId) {
      // Pool mode — return all keys in the pool
      const pool = await prisma.pool.findUnique({
        where: { id: poolId },
        include: {
          poolMembers: {
            include: {
              providerModel: {
                include: {
                  provider: {
                    include: {
                      apiKeys: {
                        select: { id: true, label: true, rpmLimit: true, tpmLimit: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!pool) {
        return NextResponse.json([]);
      }

      const allSnapshots = getAllKeyRateSnapshots();
      const snapshotMap = new Map(allSnapshots.map((s) => [s.apiKeyId, s]));

      const seen = new Set<string>();
      const entries: RateLimitEntry[] = [];

      for (const member of pool.poolMembers) {
        for (const k of member.providerModel.provider.apiKeys) {
          if (seen.has(k.id)) continue;
          seen.add(k.id);

          const snapshot = snapshotMap.get(k.id);
          entries.push({
            apiKeyId: k.id,
            apiKeyLabel: k.label,
            providerName: member.providerModel.provider.name,
            rpmCurrent: snapshot?.rpmCurrent ?? 0,
            rpmLimit: k.rpmLimit,
            tpmCurrent: snapshot?.tpmCurrent ?? 0,
            tpmLimit: k.tpmLimit,
            isWaiting: snapshot?.isWaiting ?? false,
            waitingCount: snapshot?.waitingCount ?? 0,
          });
        }
      }

      return NextResponse.json(entries);
    }

    // No specific filter — return all keys currently in the limiter
    const allSnapshots = getAllKeyRateSnapshots();
    if (allSnapshots.length === 0) {
      return NextResponse.json([]);
    }

    const keys = await prisma.apiKey.findMany({
      where: { id: { in: allSnapshots.map((s) => s.apiKeyId) } },
      select: { id: true, label: true, rpmLimit: true, tpmLimit: true, provider: { select: { name: true } } },
    });

    const keyMap = new Map(keys.map((k) => [k.id, k]));
    const entries: RateLimitEntry[] = allSnapshots.map((s) => {
      const k = keyMap.get(s.apiKeyId);
      return {
        apiKeyId: s.apiKeyId,
        apiKeyLabel: k?.label ?? s.apiKeyId,
        providerName: k?.provider.name ?? "Unknown",
        rpmCurrent: s.rpmCurrent,
        rpmLimit: k?.rpmLimit ?? null,
        tpmCurrent: s.tpmCurrent,
        tpmLimit: k?.tpmLimit ?? null,
        isWaiting: s.isWaiting,
        waitingCount: s.waitingCount,
      };
    });

    return NextResponse.json(entries);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
