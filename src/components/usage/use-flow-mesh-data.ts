"use client";

import { useEffect, useMemo, useState } from "react";
import type { FlowMapKeyInput } from "./flow-map-layout";
import type { ActiveRequest, FlowEvent } from "./use-live-flow";

// ─── Types ──────────────────────────────────────────────

export interface MeshStatusEntry {
  apiKeyId: string;
  apiKeyLabel: string;
  providerName: string;
  rpmCurrent: number;
  rpmLimit: number | null;
  isWaiting: boolean;
  waitingCount: number;
}

export interface FlowCountsPayload {
  held: number;
  inFlight: number;
  total: number;
  byKey: { apiKeyId: string; queued: number; inFlight: number }[];
}

export function isFlowCounts(v: unknown): v is FlowCountsPayload {
  const o = v as FlowCountsPayload;
  return Boolean(o && Array.isArray(o.byKey) && typeof o.held === "number");
}

const POLL_MS = 1000;

/**
 * Aggregates the per-key live data the mesh needs: RPM, limit, queued/in-flight
 * counts and provider. Merges the status API (RPM + limits) with the flow API
 * (queued/in-flight per key) on every 1s tick.
 */
export function useFlowMeshData(opts?: { filterKeys?: string[]; poolId?: string }) {
  const [status, setStatus] = useState<MeshStatusEntry[]>([]);
  const [counts, setCounts] = useState<FlowCountsPayload>({ held: 0, inFlight: 0, total: 0, byKey: [] });
  const [active, setActive] = useState<ActiveRequest[]>([]);
  const [events, setEvents] = useState<FlowEvent[]>([]);

  const filterKey = opts?.filterKeys?.join(",");

  useEffect(() => {
    let alive = true;

    async function tick() {
      try {
        const params = new URLSearchParams();
        if (opts?.poolId) params.set("poolId", opts.poolId);
        const sRes = await fetch(`/api/admin/rate-limits/status?${params.toString()}`);
        if (!alive) return;
        const sData: MeshStatusEntry[] = await sRes.json();
        setStatus(sData);

        // Note: filterKeys is applied client-side for the mesh; the flow API
        // itself is keyed by poolId only (its byKey covers all keys).
        const fRes = await fetch(`/api/admin/rate-limits/flow${params.toString() ? `?${params.toString()}` : ""}`);
        if (!alive) return;
        const fData = { active: [], events: [], counts: { held: 0, inFlight: 0, total: 0, byKey: [] } } as {
          active: ActiveRequest[];
          events: FlowEvent[];
          counts: FlowCountsPayload;
        };
        const parsed = await fRes.json();
        if (isFlowCounts(parsed.counts)) fData.counts = parsed.counts;
        fData.active = parsed.active;
        fData.events = parsed.events;
        setCounts(fData.counts);
        setActive(fData.active);
        setEvents(fData.events);
      } catch {
        // keep last good data
      }
    }

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [opts?.poolId, filterKey]);

  // Merge into mesh-friendly per-key inputs, filtered by the selected keys.
  const meshKeys: FlowMapKeyInput[] = useMemo(() => {
    const byKey = new Map(counts.byKey.map((b) => [b.apiKeyId, b]));
    const selected = filterKey ? new Set(filterKey.split(",").filter(Boolean)) : null;

    return status
      .filter((s) => (selected ? selected.has(s.apiKeyId) : true))
      .map((s) => {
        const bucket = byKey.get(s.apiKeyId);
        return {
          id: s.apiKeyId,
          label: s.apiKeyLabel,
          providerName: s.providerName,
          rpm: s.rpmCurrent,
          rpmLimit: s.rpmLimit,
          queued: bucket?.queued ?? (s.isWaiting ? s.waitingCount : 0),
          inFlight: bucket?.inFlight ?? 0,
        };
      });
  }, [status, counts.byKey, filterKey]);

  return { meshKeys, aggregated: { held: counts.held, inFlight: counts.inFlight, total: counts.total }, active, events };
}
