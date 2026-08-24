"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Server, Key, Layers,
  CircleCheck, AlertTriangle, Ban, CircleMinus,
} from "lucide-react";
import { TodayStatsCards } from "@/components/dashboard/today-stats-cards";
import { PenaltyInspector } from "@/components/dashboard/penalty-inspector";

// ─── Types ──────────────────────────────────────────────

interface HealthStats {
  providerCount: number;
  keyCount: number;
  poolCount: number;
  healthyKeys: number;
  penalizedKeys: number;
  suspendedKeys: number;
  disabledKeys: number;
}

interface PenalizedKeyRow {
  id: string;
  label: string;
  status: string;
  penaltyLevel: number;
  penaltyType: string | null;
  penaltyReason: string | null;
  penaltyExpiresAt: string | null;
  providerId: string;
  providerName: string;
  models: string[];
  poolNames: string[];
}

interface DashboardData {
  today: {
    tokens: { promptTokens: number; completionTokens: number; totalTokens: number };
    requests: { total: number; success: number; failed: number };
  };
  penalties: PenalizedKeyRow[];
}

interface ProviderOption {
  id: string;
  name: string;
  models: { id: string; name: string }[];
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState<ProviderOption[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/dashboard");
      const json = await res.json();
      setData(json);
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, []);

  // Load dashboard data + provider/model options for the penalty filter.
  useEffect(() => {
    load();
    fetch("/api/admin/models")
      .then((r) => r.json())
      .then((models: Array<{ id: string; displayName: string; provider: { id: string; name: string } }>) => {
        const byProvider = new Map<string, ProviderOption>();
        for (const m of models) {
          const existing = byProvider.get(m.provider.id) ?? { id: m.provider.id, name: m.provider.name, models: [] };
          existing.models.push({ id: m.id, name: m.displayName });
          byProvider.set(m.provider.id, existing);
        }
        setProviders(Array.from(byProvider.values()));
      })
      .catch(() => {});
  }, [load]);

  if (loading) {
    return <div className="text-muted-foreground">Loading dashboard...</div>;
  }
  if (!data) {
    return <div className="text-muted-foreground">Failed to load dashboard.</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your LLM router</p>
      </div>

      {/* Today: tokens + requests */}
      <TodayStatsCards data={data.today} />

      {/* Penalty inspector */}
      <PenaltyInspector penalties={data.penalties} providers={providers} onReset={load} />

      {/* Overview + key health summary */}
      <OverviewStats />
    </div>
  );
}

// ─── Overview stats (infrastructure + health) ──────────

function OverviewStats() {
  const [s, setS] = useState<HealthStats | null>(null);

  useEffect(() => {
    fetch("/api/admin/logs?stats=true")
      .then((r) => r.json())
      .then((d) =>
        setS({
          providerCount: d.providerCount,
          keyCount: d.keyCount,
          poolCount: d.poolCount,
          healthyKeys: d.healthyKeys,
          penalizedKeys: d.penalizedKeys,
          suspendedKeys: d.suspendedKeys,
          disabledKeys: d.disabledKeys,
        })
      )
      .catch(() => {});
  }, []);

  if (!s) return null;

  const infra = [
    { title: "Providers", value: s.providerCount, icon: Server, color: "text-green-600" },
    { title: "API Keys", value: s.keyCount, icon: Key, color: "text-emerald-600" },
    { title: "Pools", value: s.poolCount, icon: Layers, color: "text-lime-600" },
  ];
  const healthCards = [
    { label: "Healthy", value: s.healthyKeys, icon: CircleCheck, color: "text-green-600", bg: "bg-green-50 dark:bg-green-950/40" },
    { label: "Penalized", value: s.penalizedKeys, icon: AlertTriangle, color: "text-yellow-500", bg: "bg-yellow-50 dark:bg-yellow-950/40" },
    { label: "Suspended", value: s.suspendedKeys, icon: Ban, color: "text-red-500", bg: "bg-red-50 dark:bg-red-950/40" },
    { label: "Disabled", value: s.disabledKeys, icon: CircleMinus, color: "text-gray-500", bg: "bg-gray-50 dark:bg-gray-900/40" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        {infra.map((c) => (
          <Card key={c.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.title}</CardTitle>
              <c.icon className={`h-4 w-4 ${c.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <h2 className="text-lg font-semibold">Key Health</h2>
      <div className="grid gap-4 md:grid-cols-4">
        {healthCards.map((h) => (
          <Card key={h.label} className={h.bg}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">{h.label}</CardTitle>
              <h.icon className={`h-4 w-4 ${h.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{h.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
