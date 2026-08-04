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

    // No specific filter — return all keys that have limits configured OR have active traffic
    const allSnapshots = getAllKeyRateSnapshots();

    // Also query DB for all keys that have limits set (even if no traffic yet)
    const limitedKeysDb = await prisma.apiKey.findMany({
      where: {
        OR: [{ rpmLimit: { not: null } }, { tpmLimit: { not: null } }],
      },
      select: { id: true, label: true, rpmLimit: true, tpmLimit: true, provider: { select: { name: true } } },
    });

    // Merge: start with DB-limited keys, then overlay live snapshots
    const entryMap = new Map<string, RateLimitEntry>();

    for (const k of limitedKeysDb) {
      entryMap.set(k.id, {
        apiKeyId: k.id,
        apiKeyLabel: k.label,
        providerName: k.provider.name,
        rpmCurrent: 0,
        rpmLimit: k.rpmLimit,
        tpmCurrent: 0,
        tpmLimit: k.tpmLimit,
        isWaiting: false,
        waitingCount: 0,
      });
    }

    for (const s of allSnapshots) {
      const existing = entryMap.get(s.apiKeyId);
      if (existing) {
        existing.rpmCurrent = s.rpmCurrent;
        existing.tpmCurrent = s.tpmCurrent;
        existing.isWaiting = s.isWaiting;
        existing.waitingCount = s.waitingCount;
      } else {
        // Snapshot for a key not in DB? Shouldn't normally happen, but handle
        entryMap.set(s.apiKeyId, {
          apiKeyId: s.apiKeyId,
          apiKeyLabel: s.apiKeyId,
          providerName: "Unknown",
          rpmCurrent: s.rpmCurrent,
          rpmLimit: null,
          tpmCurrent: s.tpmCurrent,
          tpmLimit: null,
          isWaiting: s.isWaiting,
          waitingCount: s.waitingCount,
        });
      }
    }

    return NextResponse.json(Array.from(entryMap.values()));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
