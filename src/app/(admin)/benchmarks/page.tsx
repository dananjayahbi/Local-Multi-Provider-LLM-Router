"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshCw, ChevronDown, Activity } from "lucide-react";
import { BenchmarkStatusPanel } from "@/components/benchmarks/benchmark-status-panel";
import { ThrottleMatrix } from "@/components/benchmarks/throttle-matrix";
import { BenchmarkKeySelector } from "@/components/benchmarks/benchmark-key-selector";
import { CalibrationSessionForm } from "@/components/benchmarks/calibration-session-form";
import { CalibrationFindingsPanel } from "@/components/benchmarks/calibration-findings-panel";
import { CalibrationSessionsList } from "@/components/benchmarks/calibration-sessions-list";
import { CalibrationEventFeed } from "@/components/benchmarks/calibration-event-feed";
import { CalibrationAgentTerminal } from "@/components/benchmarks/calibration-agent-terminal";
import type {
  CalibrationProviderOption,
  CalibrationSession,
} from "@/components/benchmarks/calibration-types";

const POLL_INTERVAL_MS = 3_000;

export default function BenchmarksPage() {
  // ── Calibration session state ──────────────────────────
  const [options, setOptions] = useState<CalibrationProviderOption[]>([]);
  const [sessions, setSessions] = useState<CalibrationSession[]>([]);
  const [activeSession, setActiveSession] = useState<CalibrationSession | null>(null);
  const [starting, setStarting] = useState(false);
  const [applying, setApplying] = useState(false);

  // ── Legacy stress-test runner state ────────────────────
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [benchData, setBenchData] = useState<{
    status: { running: boolean; active: unknown[]; queueLength: number; maxParallelTests: number };
    matrix: unknown[];
    config: unknown;
  } | null>(null);
  const [benchLoading, setBenchLoading] = useState(true);
  const [benchStarting, setBenchStarting] = useState(false);

  // ── Calibration loaders ────────────────────────────────
  const loadOptions = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/calibration/options");
      const json = await res.json();
      setOptions(Array.isArray(json) ? json : []);
    } catch {
      setOptions([]);
    }
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/calibration/sessions");
      const json = await res.json();
      setSessions(Array.isArray(json) ? json : []);
    } catch {
      setSessions([]);
    }
  }, []);

  const fetchSession = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/admin/calibration/sessions/${id}`);
      if (res.ok) setActiveSession(await res.json());
    } catch {
      // ignore transient errors during polling
    }
  }, []);

  useEffect(() => {
    loadOptions();
    loadSessions();
    const id = setInterval(loadSessions, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [loadOptions, loadSessions]);

  // Keep the selected session's findings/status fresh while RUNNING.
  useEffect(() => {
    if (!activeSession || !["PENDING", "RUNNING"].includes(activeSession.status)) return;
    const id = setInterval(() => fetchSession(activeSession.id), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [activeSession, fetchSession]);

  // ── Legacy runner loader ───────────────────────────────
  const loadBenchStatus = useCallback(async (showLoading = true) => {
    if (showLoading) setBenchLoading(true);
    try {
      const res = await fetch("/api/admin/benchmarks/status");
      const json = await res.json();
      setBenchData(json);
    } catch {
      if (showLoading) setBenchData(null);
    }
    if (showLoading) setBenchLoading(false);
  }, []);

  useEffect(() => {
    loadBenchStatus(true);
    const id = setInterval(() => loadBenchStatus(false), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [loadBenchStatus]);

  // ── Handlers ───────────────────────────────────────────
  const handleStartCalibration = async (input: {
    providerId: string;
    apiKeyId: string;
    providerModelId: string;
  }) => {
    setStarting(true);
    try {
      const res = await fetch("/api/admin/calibration/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (res.ok) {
        const created = await res.json();
        await loadSessions();
        await fetchSession(created.id);
      }
    } finally {
      setStarting(false);
    }
  };

  const handleSelectSession = async (id: string) => {
    await fetchSession(id);
  };

  const handleApplyFindings = async () => {
    if (!activeSession) return;
    setApplying(true);
    try {
      const res = await fetch(`/api/admin/calibration/sessions/${activeSession.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply" }),
      });
      if (res.ok) {
        await fetchSession(activeSession.id);
        await loadSessions();
      }
    } finally {
      setApplying(false);
    }
  };

  const handleLegacyRunAll = async () => {
    setBenchStarting(true);
    try {
      await fetch("/api/admin/benchmarks", { method: "POST" });
      await loadBenchStatus(false);
    } finally {
      setBenchStarting(false);
    }
  };

  const handleLegacyRunSelected = async (apiKeyIds: string[]) => {
    setBenchStarting(true);
    try {
      await fetch("/api/admin/benchmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKeyIds }),
      });
      await loadBenchStatus(false);
    } finally {
      setBenchStarting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Calibration</h1>
          <p className="text-muted-foreground">
            Agent-driven rate-limit discovery — one provider at a time, no key stressing
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => {
            loadOptions();
            loadSessions();
          }}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* ── Left: calibration flow ── */}
        <div className="space-y-6 lg:col-span-2">
          <CalibrationSessionForm
            providers={options}
            submitting={starting}
            onSubmit={handleStartCalibration}
          />
          <CalibrationFindingsPanel
            session={activeSession}
            applying={applying}
            onApply={handleApplyFindings}
          />
          <CalibrationSessionsList
            sessions={sessions}
            activeId={activeSession?.id ?? null}
            onSelect={handleSelectSession}
          />

          {/* ── Legacy stress-test runner (fallback) ── */}
          <Card>
            <button
              className="flex w-full items-center justify-between px-6 py-4 text-left"
              onClick={() => setLegacyOpen((v) => !v)}
            >
              <CardHeader className="p-0">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  Legacy Stress-Test Runner
                  <span className="text-xs font-normal text-muted-foreground">
                    (fallback — stresses keys)
                  </span>
                </CardTitle>
              </CardHeader>
              <ChevronDown
                className={`h-4 w-4 text-muted-foreground transition-transform ${
                  legacyOpen ? "rotate-180" : ""
                }`}
              />
            </button>
            {legacyOpen && (
              <CardContent className="space-y-6">
                {benchData?.status.running && (
                  <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:bg-amber-950">
                    <Activity className="h-4 w-4 animate-pulse text-amber-500" />
                    <span className="text-amber-700 dark:text-amber-400">
                      Benchmark scheduler is running — {benchData.status.active.length} active,{" "}
                      {benchData.status.queueLength} queued
                    </span>
                  </div>
                )}

                {!benchLoading && (
                  <div className="flex justify-end">
                    <Button
                      onClick={handleLegacyRunAll}
                      disabled={benchStarting || benchData?.status.running}
                    >
                      {benchStarting ? "Starting..." : "Run All Benchmarks"}
                    </Button>
                  </div>
                )}

                <BenchmarkStatusPanel status={benchData?.status as never} />
                <BenchmarkKeySelector
                  matrix={(benchData?.matrix as never[]) ?? []}
                  onRun={handleLegacyRunSelected}
                  running={benchStarting || Boolean(benchData?.status.running)}
                />
                <ThrottleMatrix
                  matrix={(benchData?.matrix as never[]) ?? []}
                  config={benchData?.config as never}
                />
              </CardContent>
            )}
          </Card>
        </div>

        {/* ── Right: agent activity ── */}
        <div className="space-y-6 lg:col-span-1">
          <div className="h-105">
            <CalibrationAgentTerminal />
          </div>
          <CalibrationEventFeed sessionId={activeSession?.id ?? null} />
        </div>
      </div>
    </div>
  );
}
