"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, Activity } from "lucide-react";
import { DateRangeSelector, DateRangePreset } from "@/components/usage/date-range-selector";
import { UsageFilterBar } from "@/components/usage/usage-filter-bar";
import { UsageStatCards } from "@/components/usage/usage-stat-cards";
import { RateLimitCharts } from "@/components/usage/rate-limit-charts";

interface UsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
  successCount: number;
  failureCount: number;
}

interface DateRange {
  from: Date;
  to: Date;
}

const POLL_INTERVAL_MS = 5_000;

export default function UsagePage() {
  const [preset, setPreset] = useState<DateRangePreset>("today");
  const [dateRange, setDateRange] = useState<DateRange>({
    from: new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()),
    to: new Date(),
  });
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [filters, setFilters] = useState<{
    providerId?: string;
    poolId?: string;
    apiKeyId?: string;
  }>({});
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);

  // Chart mode: track which pool or key is selected for live rate charts
  const [chartMode, setChartMode] = useState<{ type: "pool" | "key"; poolId?: string; apiKeyId?: string }>({
    type: "pool",
  });

  // Keep latest params-building logic in a ref to avoid stale closures in the interval
  const paramsRef = useRef({ preset, dateRange, customFrom, customTo, filters });
  paramsRef.current = { preset, dateRange, customFrom, customTo, filters };

  const buildParams = useCallback(() => {
    const { preset: p, dateRange: dr, customFrom: cf, customTo: ct, filters: f } = paramsRef.current;
    const params = new URLSearchParams();
    let from: Date;
    let to: Date = new Date(); // Always live for non-custom

    if (p === "custom") {
      from = cf ? new Date(cf) : new Date(0);
      to = ct ? new Date(ct) : new Date();
    } else {
      from = dr.from;
      // to stays as new Date() — live clock, not stale state
    }

    params.set("dateFrom", from.toISOString());
    params.set("dateTo", to.toISOString());
    if (f.providerId) params.set("providerId", f.providerId);
    if (f.poolId) params.set("poolId", f.poolId);
    if (f.apiKeyId) params.set("apiKeyId", f.apiKeyId);
    return params;
  }, []);

  const loadUsage = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch(`/api/admin/usage?${buildParams().toString()}`);
      const data = await res.json();
      setStats(data);
    } catch {
      if (showLoading) setStats(null);
    }
    if (showLoading) setLoading(false);
  }, [buildParams]);

  // Initial load — only runs once on mount
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      loadUsage(true);
    }
  }, [loadUsage]);

  // Re-fetch when filters/dates change (user interaction)
  useEffect(() => {
    if (mountedRef.current) {
      loadUsage(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, dateRange, customFrom, customTo, filters]);

  // Live polling — reads latest params from ref, never rebuilds the interval
  useEffect(() => {
    const id = setInterval(() => loadUsage(false), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [loadUsage]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Usage & Tokens</h1>
          <p className="text-muted-foreground">Token consumption analytics across providers and keys</p>
        </div>
        <Button variant="outline" size="icon" onClick={() => loadUsage(true)}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4">
        <DateRangeSelector
          preset={preset}
          onPresetChange={(p, range) => {
            setPreset(p);
            if (p !== "custom") setDateRange(range);
          }}
          customFrom={customFrom}
          customTo={customTo}
          onCustomChange={(from, to) => {
            setCustomFrom(from);
            setCustomTo(to);
          }}
        />
        <UsageFilterBar onFiltersChange={(f) => {
          setFilters(f);
          // Sync chart mode
          if (f.apiKeyId) {
            setChartMode({ type: "key", apiKeyId: f.apiKeyId });
          } else {
            setChartMode({ type: "pool", poolId: f.poolId });
          }
        }} />
      </div>

      {loading ? (
        <div className="text-muted-foreground">Loading usage data...</div>
      ) : !stats ? (
        <div className="text-muted-foreground">Failed to load usage data.</div>
      ) : stats.requestCount === 0 ? (
        <div className="text-muted-foreground py-12 text-center">
          No usage data for the selected period and filters.
        </div>
      ) : (
        <UsageStatCards stats={stats} />
      )}

      {/* ─── Live Rate Limit Charts ─── */}
      <div className="border-t pt-6">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Live Rate Limiting</h2>
          <span className="text-xs text-muted-foreground">
            {chartMode.type === "key" ? "Single key" : chartMode.poolId ? "Pool keys" : "All active keys"}
          </span>
        </div>
        <RateLimitCharts mode={chartMode} />
      </div>
    </div>
  );
}
