"use client";

import { useEffect, useState } from "react";

export type FlowStage = "arrived" | "queued" | "assigned" | "success" | "failed";

export interface FlowEvent {
  id: string;
  requestId: string;
  poolId: string | null;
  apiKeyId: string | null;
  poolName: string | null;
  apiKeyLabel: string | null;
  providerName: string | null;
  stage: FlowStage;
  ts: number;
  waitMs?: number;
  latencyMs?: number;
  tokens?: number;
}

export interface ActiveRequest {
  requestId: string;
  poolId: string | null;
  apiKeyId: string | null;
  poolName: string | null;
  apiKeyLabel: string | null;
  providerName: string | null;
  stage: "queued" | "in_flight";
  startedAt: number;
  waitMs?: number;
  latencyMs?: number;
}

export interface FlowCounts {
  held: number;
  inFlight: number;
  total: number;
  byKey: { apiKeyId: string; queued: number; inFlight: number }[];
}

export interface FlowSnapshot {
  active: ActiveRequest[];
  events: FlowEvent[];
  counts: FlowCounts;
}

const POLL_MS = 1000;

/**
 * Polls /api/admin/rate-limits/flow for the live data-flow snapshot used by the
 * animation. Keeps the last good snapshot across transient network errors so the
 * canvas never blanks out.
 */
export function useLiveFlow(filter?: { poolId?: string; apiKeyId?: string }) {
  const [snapshot, setSnapshot] = useState<FlowSnapshot>({
    active: [],
    events: [],
    counts: { held: 0, inFlight: 0, total: 0, byKey: [] },
  });
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const params = new URLSearchParams();
        if (filter?.poolId) params.set("poolId", filter.poolId);
        if (filter?.apiKeyId) params.set("apiKeyId", filter.apiKeyId);
        const qs = params.toString();
        const res = await fetch(`/api/admin/rate-limits/flow${qs ? `?${qs}` : ""}`);
        if (!active) return;
        const data: FlowSnapshot = await res.json();
        setSnapshot(data);
        setConnected(true);
      } catch {
        if (active) setConnected(false);
      }
    }

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [filter?.poolId, filter?.apiKeyId]);

  return { snapshot, connected };
}
