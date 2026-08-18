"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Play, RefreshCw, Activity } from "lucide-react";
import { BenchmarkStatusPanel } from "@/components/benchmarks/benchmark-status-panel";
import { ThrottleMatrix } from "@/components/benchmarks/throttle-matrix";

interface BenchmarkStatus {
  status: {
    running: boolean;
    active: Array<{ apiKeyId: string; providerId: string; startedAt: number; stage: string }>;
    queueLength: number;
    maxParallelTests: number;
  };
  matrix: Array<{
    apiKeyId: string;
    apiKeyLabel: string;
    providerName: string;
    status: string;
    latestBenchmark: {
      ttftMs: number;
      avgTps: number;
      latencyDriftRatio: number;
      isThrottled: boolean;
      passed: boolean;
      testedAt: string;
    } | null;
  }>;
  config: {
    targetTps: number;
    targetRpm: number;
    ttftDriftThreshold: number;
    tpsDriftThreshold: number;
  };
}

const POLL_INTERVAL_MS = 3_000;

export default function BenchmarksPage() {
  const [data, setData] = useState<BenchmarkStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  const loadStatus = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch("/api/admin/benchmarks/status");
      const json = await res.json();
      setData(json);
    } catch {
      if (showLoading) setData(null);
    }
    if (showLoading) setLoading(false);
  }, []);

  useEffect(() => {
    loadStatus(true);
    const id = setInterval(() => loadStatus(false), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [loadStatus]);

  const handleRunAll = async () => {
    setStarting(true);
    try {
      await fetch("/api/admin/benchmarks", { method: "POST" });
      await loadStatus(false);
    } finally {
      setStarting(false);
    }
  };

  if (loading) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Benchmarks</h1>
          <p className="text-muted-foreground">
            Autonomous benchmarking & silent throttle detection
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => loadStatus(true)}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={handleRunAll} disabled={starting || data?.status.running}>
            <Play className="mr-2 h-4 w-4" />
            {starting ? "Starting..." : "Run All Benchmarks"}
          </Button>
        </div>
      </div>

      {data?.status.running && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950 p-3 text-sm">
          <Activity className="h-4 w-4 text-amber-500 animate-pulse" />
          <span className="text-amber-700 dark:text-amber-400">
            Benchmark scheduler is running — {data.status.active.length} active,{" "}
            {data.status.queueLength} queued
          </span>
        </div>
      )}

      <BenchmarkStatusPanel status={data?.status} />

      <Card>
        <CardHeader>
          <CardTitle>Throttle Analytics Matrix</CardTitle>
        </CardHeader>
        <CardContent>
          <ThrottleMatrix matrix={data?.matrix ?? []} config={data?.config} />
        </CardContent>
      </Card>
    </div>
  );
}
