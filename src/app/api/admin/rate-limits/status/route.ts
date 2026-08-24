// ─── Rate Limits Status API ────────────────────────────
// GET /api/admin/rate-limits/status
// Returns live RPM/TPM/RPD/TPD snapshots from the in-memory rate limiter,
// with the DB-configured ceilings and a server-side history buffer so the
// /usage charts survive a refresh.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getAllKeyRateSnapshots,
  getKeyRateSnapshot,
  getRateHistory,
  appendRateHistorySnapshot,
  RateHistoryPoint,
} from "@/engine/rate-limit/api-key-rate-limiter";

export interface RateLimitEntry {
  apiKeyId: string;
  apiKeyLabel: string;
  providerName: string;
  rpmCurrent: number;
  rpmLimit: number | null;
  tpmCurrent: number;
  tpmLimit: number | null;
  rpdCurrent: number;
  rpdLimit: number | null;
  tpdCurrent: number;
  tpdLimit: number | null;
  isWaiting: boolean;
  waitingCount: number;
  history: RateHistoryPoint[];
}

/** Build the API-key select common to single/pool/all modes. */
const keySelect = {
  id: true,
  label: true,
  rpmLimit: true,
  tpmLimit: true,
  rpdLimit: true,
  tpdLimit: true,
  provider: { select: { name: true } },
} as const;

function enrich(entry: Omit<RateLimitEntry, "history">): RateLimitEntry {
  // Seed the server-side history buffer from the live snapshot so the chart
  // never starts empty and survives a page refresh.
  appendRateHistorySnapshot(entry.apiKeyId);
  return { ...entry, history: getRateHistory(entry.apiKeyId) };
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
        select: keySelect,
      });

      if (!key) {
        return NextResponse.json([]);
      }

      return NextResponse.json([
        enrich({
          apiKeyId,
          apiKeyLabel: key.label,
          providerName: key.provider.name,
          rpmCurrent: snapshot?.rpmCurrent ?? 0,
          rpmLimit: key.rpmLimit,
          tpmCurrent: snapshot?.tpmCurrent ?? 0,
          tpmLimit: key.tpmLimit,
          rpdCurrent: snapshot?.rpdCurrent ?? 0,
          rpdLimit: key.rpdLimit,
          tpdCurrent: snapshot?.tpdCurrent ?? 0,
          tpdLimit: key.tpdLimit,
          isWaiting: snapshot?.isWaiting ?? false,
          waitingCount: snapshot?.waitingCount ?? 0,
        }),
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
                        select: { id: true, label: true, rpmLimit: true, tpmLimit: true, rpdLimit: true, tpdLimit: true },
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
          entries.push(
            enrich({
              apiKeyId: k.id,
              apiKeyLabel: k.label,
              providerName: member.providerModel.provider.name,
              rpmCurrent: snapshot?.rpmCurrent ?? 0,
              rpmLimit: k.rpmLimit,
              tpmCurrent: snapshot?.tpmCurrent ?? 0,
              tpmLimit: k.tpmLimit,
              rpdCurrent: snapshot?.rpdCurrent ?? 0,
              rpdLimit: k.rpdLimit,
              tpdCurrent: snapshot?.tpdCurrent ?? 0,
              tpdLimit: k.tpdLimit,
              isWaiting: snapshot?.isWaiting ?? false,
              waitingCount: snapshot?.waitingCount ?? 0,
            })
          );
        }
      }

      return NextResponse.json(entries);
    }

    // No specific filter — return all keys that have limits configured OR have active traffic
    const allSnapshots = getAllKeyRateSnapshots();

    // Also query DB for all keys that have ANY limit set (rpm/tpm/rpd/tpd),
    // so auto-calibrated RPD/TPD-only keys show up even without traffic yet.
    const limitedKeysDb = await prisma.apiKey.findMany({
      where: {
        OR: [
          { rpmLimit: { not: null } },
          { tpmLimit: { not: null } },
          { rpdLimit: { not: null } },
          { tpdLimit: { not: null } },
        ],
      },
      select: keySelect,
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
        rpdCurrent: 0,
        rpdLimit: k.rpdLimit,
        tpdCurrent: 0,
        tpdLimit: k.tpdLimit,
        isWaiting: false,
        waitingCount: 0,
        history: getRateHistory(k.id),
      });
    }

    for (const s of allSnapshots) {
      const existing = entryMap.get(s.apiKeyId);
      if (existing) {
        existing.rpmCurrent = s.rpmCurrent;
        existing.tpmCurrent = s.tpmCurrent;
        existing.rpdCurrent = s.rpdCurrent;
        existing.tpdCurrent = s.tpdCurrent;
        existing.isWaiting = s.isWaiting;
        existing.waitingCount = s.waitingCount;
        existing.history = getRateHistory(s.apiKeyId);
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
          rpdCurrent: s.rpdCurrent,
          rpdLimit: null,
          tpdCurrent: s.tpdCurrent,
          tpdLimit: null,
          isWaiting: s.isWaiting,
          waitingCount: s.waitingCount,
          history: getRateHistory(s.apiKeyId),
        });
      }
    }

    return NextResponse.json(Array.from(entryMap.values()).map((e) => enrich(e)));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
