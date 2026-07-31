"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Gauge, AlertCircle } from "lucide-react";

// ─── Types ──────────────────────────────────────────────

interface RateLimitEntry {
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

interface ChartMode {
  type: "pool" | "key";
  poolId?: string;
  apiKeyId?: string;
}

interface DataPoint {
  time: number;
  value: number;
}

interface LineSeries {
  key: string;
  label: string;
  color: string;
  data: DataPoint[];
  threshold: number | null; // null = no limit
}

// ─── Constants ──────────────────────────────────────────

const POLL_MS = 1000;
const MAX_DATA_POINTS = 60; // 1 minute of data at 1s polling
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

// ─── SVG Line Chart Sub-component ───────────────────────

interface LiveLineChartProps {
  title: string;
  seriesList: LineSeries[];
  unit: string;
}

function LiveLineChart({ title, seriesList, unit }: LiveLineChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const PADDING = { top: 16, right: 16, bottom: 28, left: 48 };

  const allValues = seriesList.flatMap((s) => s.data.map((d) => d.value));
  const allThresholds = seriesList
    .map((s) => s.threshold)
    .filter((t): t is number => t != null && t > 0);

  const minVal = 0;
  const maxVal = Math.max(
    ...allValues,
    ...allThresholds,
    10 // minimum visible range
  );
  const range = maxVal - minVal || 1;

  const W = 600;
  const H = 200;
  const innerW = W - PADDING.left - PADDING.right;
  const innerH = H - PADDING.top - PADDING.bottom;

  const scaleX = (i: number) => PADDING.left + (i / Math.max(MAX_DATA_POINTS - 1, 1)) * innerW;
  const scaleY = (v: number) => PADDING.top + innerH - ((v - minVal) / range) * innerH;

  // Build Y-axis ticks
  const yTicks: number[] = [];
  const tickCount = 4;
  for (let i = 0; i <= tickCount; i++) {
    yTicks.push(Math.round(minVal + (range / tickCount) * i));
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
          {/* Grid lines */}
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={PADDING.left}
                y1={scaleY(tick)}
                x2={W - PADDING.right}
                y2={scaleY(tick)}
                stroke="#e5e7eb"
                strokeDasharray="4 2"
              />
              <text
                x={PADDING.left - 6}
                y={scaleY(tick) + 4}
                textAnchor="end"
                className="text-[10px] fill-gray-400"
              >
                {tick}
              </text>
            </g>
          ))}

          {/* Threshold lines */}
          {seriesList.map((series) => {
            if (series.threshold == null || series.threshold <= 0) return null;
            const y = scaleY(series.threshold);
            return (
              <g key={`thresh-${series.key}`}>
                <line
                  x1={PADDING.left}
                  y1={y}
                  x2={W - PADDING.right}
                  y2={y}
                  stroke={series.color}
                  strokeWidth="1.5"
                  strokeDasharray="6 3"
                  opacity={0.6}
                />
                <text
                  x={W - PADDING.right - 4}
                  y={y - 5}
                  textAnchor="end"
                  className="text-[9px]"
                  fill={series.color}
                >
                  {series.threshold} {unit}
                </text>
              </g>
            );
          })}

          {/* Data lines */}
          {seriesList.map((series) => {
            if (series.data.length < 2) return null;
            const points = series.data
              .map((d, i) => `${scaleX(i)},${scaleY(d.value)}`)
              .join(" ");

            return (
              <g key={series.key}>
                <polyline
                  points={points}
                  fill="none"
                  stroke={series.color}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {/* Label */}
                {series.data.length > 0 && (
                  <text
                    x={scaleX(series.data.length - 1) + 4}
                    y={scaleY(series.data[series.data.length - 1].value) + 4}
                    className="text-[10px] font-medium"
                    fill={series.color}
                  >
                    {series.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* No data */}
          {seriesList.every((s) => s.data.length === 0) && (
            <text
              x={W / 2}
              y={H / 2}
              textAnchor="middle"
              className="text-xs fill-gray-400"
            >
              Waiting for data...
            </text>
          )}
        </svg>
      </CardContent>
    </Card>
  );
}

// ─── Queue Indicator ────────────────────────────────────

function QueueIndicator({ entries }: { entries: RateLimitEntry[] }) {
  const waitingEntries = entries.filter((e) => e.isWaiting);

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
              .map((e) => `${e.apiKeyLabel} (${e.waitingCount} queued)`)
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
  const [rpmSeries, setRpmSeries] = useState<LineSeries[]>([]);
  const [tpmSeries, setTpmSeries] = useState<LineSeries[]>([]);

  // Poll for live data
  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const qs = buildQuery(mode);
        const res = await fetch(`/api/admin/rate-limits/status?${qs}`);
        if (!active) return;
        const data: RateLimitEntry[] = await res.json();
        setEntries(data);

        const now = Date.now();

        setRpmSeries((prev) =>
          data.map((entry, i) => {
            const key = entry.apiKeyId;
            const existing = prev.find((s) => s.key === key);
            const point: DataPoint = { time: now, value: entry.rpmCurrent };
            const dataPoints = existing
              ? [...existing.data.slice(-MAX_DATA_POINTS + 1), point]
              : [point];

            return {
              key,
              label: entry.apiKeyLabel,
              color: CHART_COLORS[i % CHART_COLORS.length],
              data: dataPoints,
              threshold: entry.rpmLimit,
            };
          })
        );

        setTpmSeries((prev) =>
          data.map((entry, i) => {
            const key = entry.apiKeyId;
            const existing = prev.find((s) => s.key === key);
            const point: DataPoint = { time: now, value: entry.tpmCurrent };
            const dataPoints = existing
              ? [...existing.data.slice(-MAX_DATA_POINTS + 1), point]
              : [point];

            return {
              key,
              label: entry.apiKeyLabel,
              color: CHART_COLORS[i % CHART_COLORS.length],
              data: dataPoints,
              threshold: entry.tpmLimit,
            };
          })
        );
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

  const hasLimits = entries.some(
    (e) => (e.rpmLimit && e.rpmLimit > 0) || (e.tpmLimit && e.tpmLimit > 0)
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
            Set RPM/TPM limits on API keys to see live charts here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <QueueIndicator entries={entries} />

      <LiveLineChart title="Requests Per Minute (RPM)" seriesList={rpmSeries} unit="req" />
      <LiveLineChart title="Tokens Per Minute (TPM)" seriesList={tpmSeries} unit="tok" />
    </div>
  );
}
