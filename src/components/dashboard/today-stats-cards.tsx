"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Coins, ArrowUpRight, ArrowDownRight, CheckCircle2, XCircle, Hash } from "lucide-react";

// ─── Types ──────────────────────────────────────────────

interface TodayData {
  tokens: { promptTokens: number; completionTokens: number; totalTokens: number };
  requests: { total: number; success: number; failed: number };
}

interface TodayStatsCardsProps {
  data: TodayData | null;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * "Today" widget: token usage (input / output / total) and request outcomes
 * (success / failed), shown as a row of compact cards.
 */
export function TodayStatsCards({ data }: TodayStatsCardsProps) {
  if (!data) return null;

  const tokenCards = [
    { title: "Input Tokens", value: fmt(data.tokens.promptTokens), icon: ArrowUpRight, color: "text-green-600", sub: "prompt" },
    { title: "Output Tokens", value: fmt(data.tokens.completionTokens), icon: ArrowDownRight, color: "text-emerald-600", sub: "completion" },
    { title: "Total Tokens", value: fmt(data.tokens.totalTokens), icon: Coins, color: "text-lime-600", sub: "today" },
  ];

  const requestCards = [
    { title: "Total Requests", value: data.requests.total, icon: Hash, color: "text-gray-500", sub: "today" },
    { title: "Successful", value: data.requests.success, icon: CheckCircle2, color: "text-green-600", sub: `${data.requests.total > 0 ? Math.round((data.requests.success / data.requests.total) * 100) : 0}% of total` },
    { title: "Failed", value: data.requests.failed, icon: XCircle, color: "text-red-500", sub: `${data.requests.total > 0 ? Math.round((data.requests.failed / data.requests.total) * 100) : 0}% of total` },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Coins className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Today</h2>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {tokenCards.map((c) => (
          <Card key={c.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.title}</CardTitle>
              <c.icon className={`h-4 w-4 ${c.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">{c.value}</div>
              <p className="text-xs text-muted-foreground">{c.sub}</p>
            </CardContent>
          </Card>
        ))}

        {requestCards.map((c) => (
          <Card key={c.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.title}</CardTitle>
              <c.icon className={`h-4 w-4 ${c.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tabular-nums">{c.value}</div>
              <p className="text-xs text-muted-foreground">{c.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
