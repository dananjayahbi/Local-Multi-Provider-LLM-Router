"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Gauge, AlertCircle, Clock } from "lucide-react";
import { SmoothRateChart, ChartPoint } from "./smooth-rate-chart";

// ─── Types ──────────────────────────────────────────────

interface RateHistoryPoint {
  ts: number;
  rpm: number;
  tpm: number;
  rpd: number;
  tpd: number;
}

interface RateLimitEntry {
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

interface ChartMode {
  type: "pool" | "key";
  poolId?: string;
  apiKeyId?: string;
}

interface ChartSeries {
  key: string;
  label: string;
  color: string;
  data: ChartPoint[];
  threshold: number | null; // null = no limit
}

// ─── Constants ──────────────────────────────────────────

const POLL_MS = 1000;
const MAX_DATA_POINTS = 240; // ~4 minutes at 1s polling (server caps at 300)
const CHART_COLORS = [
  "#6366f1", "#ec4899", "#14b8a6", "#f59e0b", "#8b5cf6",
  "#06b6d4", "#ef4444", "#22c55e", "#e11d48", "#3b82f6",
];

// ─── Helper: build query string ────────────────────────

function buildQuery(mode: ChartMode): string {
  const params = new URLSearchParams();
  if (mode.type === "key" && mode.apiKeyId) params.set("apiKeyId", mode.apiKeyId);
  if (mode.type === "pool" && mode.poolId) params.set("poolId", mode.poolId);
  return params.toString();
}

// ─── Queue Indicator ────────────────────────────────────

function QueueIndicator({ entries }: { entries: RateLimitEntry[] }) {
  // Only flag keys that are genuinely saturated: they have a limit AND their
  // live counter is at/above the ceiling (i.e. the gateway is throttling).
  const waitingEntries = entries.filter(
    (e) =>
      (e.rpmLimit && e.rpmCurrent >= e.rpmLimit) ||
      (e.tpmLimit && e.tpmCurrent >= e.tpmLimit)
  );

  if (waitingEntries.length === 0) return null;

  return (
    <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
      <CardContent className="flex items-center gap-3 py-3">
        <AlertCircle className="h-5 w-5 text-amber-600 animate-pulse" />
        <div>
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            Gateway holding requests — rate limiting active
          </p>
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {waitingEntries
              .map((e) => `${e.apiKeyLabel} (rpm ${e.rpmCurrent}/${e.rpmLimit ?? "∞"} · tpm ${e.tpmCurrent}/${e.tpmLimit ?? "∞"})`)
              .join(", ")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Component ─────────────────────────────────────

interface RateLimitChartsProps {
  mode: ChartMode;
}

export function RateLimitCharts({ mode }: RateLimitChartsProps) {
  const [entries, setEntries] = useState<RateLimitEntry[]>([]);
  const [timeline, setTimeline] = useState<"min" | "hour">("min");

  // Poll for live data — seeds from server history on the first response so a
  // page refresh preserves the line instead of starting from scratch.
  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const qs = buildQuery(mode);
        const res = await fetch(`/api/admin/rate-limits/status?${qs}`);
        if (!active) return;
        const data: RateLimitEntry[] = await res.json();
        setEntries(data);
      } catch {
        // silently ignore poll errors
      }
    }

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [mode]);

  // Derive series directly from the current entries + their server history.
  // We keep the FULL history buffer and slice it by the selected timeline so
  // the chart never resets and the lines stay smooth.
  const rpmSeries: ChartSeries[] = entries.map((e, i) => {
    const color = CHART_COLORS[i % CHART_COLORS.length];
    const history = (e.history ?? []).filter((p) =>
      timeline === "hour" ? true : p.ts >= Date.now() - MAX_DATA_POINTS * POLL_MS
    );
    return {
      key: e.apiKeyId,
      label: e.apiKeyLabel,
      color,
      data: history.map((p) => ({ time: p.ts, value: p.rpm })),
      threshold: e.rpmLimit,
    };
  });

  const tpmSeries: ChartSeries[] = entries.map((e, i) => {
    const color = CHART_COLORS[i % CHART_COLORS.length];
    const history = (e.history ?? []).filter((p) =>
      timeline === "hour" ? true : p.ts >= Date.now() - MAX_DATA_POINTS * POLL_MS
    );
    return {
      key: e.apiKeyId,
      label: e.apiKeyLabel,
      color,
      data: history.map((p) => ({ time: p.ts, value: p.tpm })),
      threshold: e.tpmLimit,
    };
  });

  // Seed a deterministic color map across entries (stable per apiKeyId).
  const colorMap = new Map(entries.map((e, i) => [e.apiKeyId, CHART_COLORS[i % CHART_COLORS.length]]));

  const hasLimits = entries.some(
    (e) =>
      (e.rpmLimit && e.rpmLimit > 0) ||
      (e.tpmLimit && e.tpmLimit > 0) ||
      (e.rpdLimit && e.rpdLimit > 0) ||
      (e.tpdLimit && e.tpdLimit > 0)
  );

  if (!hasLimits) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-8 text-center">
          <Gauge className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">
            No rate-limited keys active in the selected scope.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Set RPM / TPM / RPD / TPD limits on API keys to see live charts here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <QueueIndicator entries={entries} />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          <div className="inline-flex rounded-md border p-0.5">
            <button
              onClick={() => setTimeline("min")}
              className={`rounded px-2 py-0.5 transition-colors ${timeline === "min" ? "bg-muted font-medium" : "hover:bg-muted/60"}`}
            >
              ~4 min
            </button>
            <button
              onClick={() => setTimeline("hour")}
              className={`rounded px-2 py-0.5 transition-colors ${timeline === "hour" ? "bg-muted font-medium" : "hover:bg-muted/60"}`}
            >
              full history
            </button>
          </div>
        </div>
      </div>

      <SmoothRateChart
        title="Requests Per Minute (RPM)"
        subtitle={`${entries.length} key(s)`}
        seriesList={rpmSeries.map((s) => ({ ...s, color: colorMap.get(s.key) ?? s.color }))}
        unit="req"
      />
      <SmoothRateChart
        title="Tokens Per Minute (TPM)"
        subtitle={`${entries.length} key(s)`}
        seriesList={tpmSeries.map((s) => ({ ...s, color: colorMap.get(s.key) ?? s.color }))}
        unit="tok"
      />
    </div>
  );
}
