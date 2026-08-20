"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Play, Loader2 } from "lucide-react";

interface MatrixEntry {
  apiKeyId: string;
  apiKeyLabel: string;
  providerName: string;
  status: string;
  calibrated: boolean;
  lastCalibratedAt: string | null;
  latestBenchmark: {
    ttftMs: number;
    avgTps: number;
    latencyDriftRatio: number;
    isThrottled: boolean;
    passed: boolean;
    testedAt: string;
  } | null;
}

export function BenchmarkKeySelector({
  matrix,
  onRun,
  running,
}: {
  matrix: MatrixEntry[];
  onRun: (apiKeyIds: string[]) => void;
  running: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => {
      if (prev.size === matrix.length) return new Set();
      return new Set(matrix.map((m) => m.apiKeyId));
    });
  };

  const handleRun = () => {
    if (selected.size === 0) return;
    onRun(Array.from(selected));
  };

  if (matrix.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">Select Keys to Test</CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={toggleAll}>
            {selected.size === matrix.length ? "Clear All" : "Select All"}
          </Button>
          <Button size="sm" onClick={handleRun} disabled={selected.size === 0 || running}>
            {running ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Play className="mr-1 h-3 w-3" />
            )}
            Run Selected ({selected.size})
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {matrix.map((entry) => {
            const isSelected = selected.has(entry.apiKeyId);
            return (
              <button
                key={entry.apiKeyId}
                onClick={() => toggle(entry.apiKeyId)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  isSelected
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-muted"
                }`}
              >
                {isSelected && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
                <span className="font-medium">{entry.apiKeyLabel}</span>
                <span className="text-xs text-muted-foreground">{entry.providerName}</span>
                {entry.calibrated && (
                  <Badge variant="success" className="text-[10px]">
                    Calibrated
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
