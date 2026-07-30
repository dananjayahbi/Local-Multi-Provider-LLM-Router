"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Server,
  Key,
  Layers,
  Activity,
  AlertTriangle,
  Ban,
  CircleCheck,
  CircleMinus,
  TrendingUp,
} from "lucide-react";

interface DashboardStats {
  providerCount: number;
  keyCount: number;
  poolCount: number;
  healthyKeys: number;
  penalizedKeys: number;
  suspendedKeys: number;
  disabledKeys: number;
  requestsToday: number;
  failuresToday: number;
  failureRate: string;
  recentFailures: Array<{
    id: string;
    errorClassification: string | null;
    apiKey?: { label: string; provider: { name: string } } | null;
    pool?: { name: string } | null;
    createdAt: string;
  }>;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/logs?stats=true")
      .then((r) => r.json())
      .then((data) => {
        setStats(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-muted-foreground">Loading dashboard...</div>;
  }

  if (!stats) {
    return <div className="text-muted-foreground">Failed to load dashboard.</div>;
  }

  const cards = [
    { title: "Providers", value: stats.providerCount, icon: Server, color: "text-blue-500" },
    { title: "API Keys", value: stats.keyCount, icon: Key, color: "text-violet-500" },
    { title: "Pools", value: stats.poolCount, icon: Layers, color: "text-emerald-500" },
    { title: "Requests Today", value: stats.requestsToday, icon: Activity, color: "text-amber-500" },
  ];

  const healthCards = [
    { label: "Healthy", value: stats.healthyKeys, icon: CircleCheck, color: "text-green-500", bg: "bg-green-50 dark:bg-green-950" },
    { label: "Penalized", value: stats.penalizedKeys, icon: AlertTriangle, color: "text-yellow-500", bg: "bg-yellow-50 dark:bg-yellow-950" },
    { label: "Suspended", value: stats.suspendedKeys, icon: Ban, color: "text-red-500", bg: "bg-red-50 dark:bg-red-950" },
    { label: "Disabled", value: stats.disabledKeys, icon: CircleMinus, color: "text-gray-500", bg: "bg-gray-50 dark:bg-gray-900" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your LLM router</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {c.title}
              </CardTitle>
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

      <div className="flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          Failure rate today: <span className="font-medium text-red-500">{stats.failureRate}%</span>
        </span>
      </div>

      <h2 className="text-lg font-semibold">Recent Failures</h2>
      {stats.recentFailures.length === 0 ? (
        <p className="text-sm text-muted-foreground">No recent failures 🎉</p>
      ) : (
        <div className="space-y-2">
          {stats.recentFailures.map((f) => (
            <div key={f.id} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
              <Badge variant="destructive">{f.errorClassification || "UNKNOWN"}</Badge>
              <span>{f.apiKey?.label || "?"} @ {f.apiKey?.provider?.name || "?"}</span>
              <span className="text-muted-foreground">
                {new Date(f.createdAt).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
