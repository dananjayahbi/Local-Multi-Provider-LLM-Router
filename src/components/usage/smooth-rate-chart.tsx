"use client";

import { useMemo } from "react";
import {
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// ─── Types ──────────────────────────────────────────────

export interface ChartPoint {
  /** epoch ms of the sample */
  time: number;
  /** the live value (rpm or tpm) */
  value: number;
}

export interface ChartSeries {
  key: string;
  label: string;
  color: string;
  data: ChartPoint[];
  /** The configured hard ceiling — rendered as a dashed reference line. */
  threshold: number | null;
}

interface SmoothRateChartProps {
  title: string;
  subtitle?: string;
  seriesList: ChartSeries[];
  unit: string;
  /** If true use a filled AreaChart with a smooth curve; otherwise a line. */
  area?: boolean;
}

// ─── Helpers ────────────────────────────────────────────

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour12: false });
}

function formatValue(v: number, unit: string): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M ${unit}`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k ${unit}`;
  return `${Math.round(v)} ${unit}`;
}

// ─── Custom tooltip ─────────────────────────────────────

function ChartTooltip({ active, payload, label, unit }: any) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border bg-background/95 px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-muted-foreground">{fmtTime(label)}</p>
      {payload.map((entry: any) => (
        <p key={entry.dataKey} style={{ color: entry.color }} className="font-semibold tabular-nums">
          {entry.name}: {entry.value != null ? formatValue(entry.value, unit) : "—"}
        </p>
      ))}
    </div>
  );
}

// ─── Main chart ─────────────────────────────────────────

export function SmoothRateChart({ title, subtitle, seriesList, unit, area = true }: SmoothRateChartProps) {
  // Merge all series into a single time-indexed dataset so recharts can plot
  // multiple `value-{key}` keys on a shared x-axis. Each series keeps its own
  // (possibly offset) sampling timeline.
  const merged = useMemo(() => {
    const map = new Map<number, Record<string, number>>();
    for (const s of seriesList) {
      for (const p of s.data) {
        const bucket = map.get(p.time) ?? {};
        bucket[`value-${s.key}`] = p.value;
        map.set(p.time, bucket);
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([time, vals]) => ({ time, ...vals }));
  }, [seriesList]);

  const hasData = seriesList.some((s) => s.data.length > 0);
  const thresholds: { name: string; value: number; color: string }[] = seriesList
    .filter((s): s is ChartSeries & { threshold: number } => s.threshold != null && s.threshold > 0)
    .map((s) => ({ name: s.label, value: s.threshold, color: s.color }));

  // Compute a nice Y ceiling that fits all values + thresholds.
  const maxVal = Math.max(
    1,
    ...seriesList.flatMap((s) => s.data.map((d) => d.value)),
    ...thresholds.map((t) => t.value),
    10
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          {title}
          {subtitle && <span className="ml-2 text-xs font-normal text-muted-foreground">{subtitle}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
            Waiting for data…
          </div>
        ) : (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={merged} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                <defs>
                  {seriesList.map((s) => (
                    <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={s.color} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={s.color} stopOpacity={0.02} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal vertical={false} />
                <XAxis
                  dataKey="time"
                  tickFormatter={fmtTime}
                  tick={{ fontSize: 11, fill: "#9ca3af" }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={40}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#9ca3af" }}
                  tickLine={false}
                  axisLine={false}
                  width={46}
                  domain={[0, maxVal]}
                  tickFormatter={(v: number) => formatValue(v, unit)}
                />
                <Tooltip content={<ChartTooltip unit={unit} />} />
                <Legend
                  iconType="plainline"
                  wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                />

                {/* Hard ceiling reference lines */}
                {thresholds.map((t) => (
                  <ReferenceLine
                    key={`ref-${t.name}-${t.value}`}
                    y={t.value}
                    stroke={t.color}
                    strokeDasharray="6 3"
                    strokeOpacity={0.7}
                    label={{ value: `${formatValue(t.value, unit)} cap`, fontSize: 10, fill: t.color, position: "insideTopRight" }}
                  />
                ))}

                {seriesList.map((s) =>
                  area ? (
                    <Area
                      key={s.key}
                      type="monotone"
                      dataKey={`value-${s.key}`}
                      name={s.label}
                      stroke={s.color}
                      strokeWidth={2.5}
                      fill={`url(#grad-${s.key})`}
                      dot={false}
                      activeDot={{ r: 4 }}
                      animationDuration={300}
                    />
                  ) : (
                    <Line
                      key={s.key}
                      type="monotone"
                      dataKey={`value-${s.key}`}
                      name={s.label}
                      stroke={s.color}
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 4 }}
                      animationDuration={300}
                    />
                  )
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
