"use client";

// ─── Algorithm Simulator ───────────────────────────────
// Task 09. Configure a mock pool + scripted workload, tune the
// selector weights/options, run the scenario, and inspect the
// full decision trace (route / penalty / injection).

import { useMemo, useState } from "react";
import {
  ScenarioResult,
  ScenarioStep,
  SelectorWeights,
  SimKey,
  defaultMockPool,
  errorInjectionScript,
  growingChatScript,
  runScenario,
} from "@/engine/playground";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Play, RotateCcw } from "lucide-react";
import { MockKeyEditor } from "./mock-key-editor";
import { ScriptEditor } from "./script-editor";
import { TraceViewer } from "./trace-viewer";

export function AlgorithmSimulator() {
  const [keys, setKeys] = useState<SimKey[]>(() => defaultMockPool());
  const [steps, setSteps] = useState<ScenarioStep[]>(() => growingChatScript());
  const [stickyStart, setStickyStart] = useState<string>("k1");
  const [emitInjection, setEmitInjection] = useState(true);
  const [allowPenalized, setAllowPenalized] = useState(true);
  const [stickyBudget, setStickyBudget] = useState<number>(2000);
  const [weights, setWeights] = useState<SelectorWeights>({
    sticky: 100,
    exhaust: 1,
    contextFit: 0.6,
    speed: 0.2,
    rotationCost: 0.8,
  });
  const [result, setResult] = useState<ScenarioResult | null>(null);

  const run = () => {
    setResult(
      runScenario(
        keys,
        steps,
        {
          weights,
          allowPenalized,
          stickyBudgetTokens: stickyBudget,
          emitInjection,
        },
        stickyStart
      )
    );
  };

  const loadPreset = (name: "growing" | "errors") => {
    setSteps(name === "growing" ? growingChatScript() : errorInjectionScript());
  };

  const weightFields: Array<{ key: keyof SelectorWeights; label: string }> = [
    { key: "sticky", label: "Sticky (cache)" },
    { key: "exhaust", label: "Exhaustability" },
    { key: "contextFit", label: "Context fit" },
    { key: "speed", label: "Speed" },
    { key: "rotationCost", label: "Rotation cost" },
  ];

  const stickyOptions = useMemo(
    () => keys.filter((k) => k.status === "ACTIVE"),
    [keys]
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Config column */}
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Scenario</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] uppercase text-muted-foreground">Sticky start key</Label>
                <select
                  value={stickyStart}
                  onChange={(e) => setStickyStart(e.target.value)}
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                >
                  <option value="">(none)</option>
                  {stickyOptions.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[10px] uppercase text-muted-foreground">Sticky budget (tokens)</Label>
                <Input
                  type="number"
                  className="h-9 w-32"
                  value={stickyBudget}
                  onChange={(e) => setStickyBudget(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" checked={emitInjection} onChange={(e) => setEmitInjection(e.target.checked)} />
                Emit Copilot injection on rotation
              </label>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" checked={allowPenalized} onChange={(e) => setAllowPenalized(e.target.checked)} />
                Fall back to penalized keys
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {weightFields.map(({ key, label }) => (
                <div key={key} className="flex flex-col gap-1">
                  <Label className="text-[10px] uppercase text-muted-foreground">{label}</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={weights[key]}
                    onChange={(e) => setWeights({ ...weights, [key]: Number(e.target.value) })}
                  />
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={run}>
                <Play className="h-4 w-4" /> Run scenario
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setKeys(defaultMockPool());
                  setSteps(growingChatScript());
                  setResult(null);
                }}
              >
                <RotateCcw className="h-4 w-4" /> Reset
              </Button>
              <Button variant="ghost" size="sm" onClick={() => loadPreset("errors")}>
                Load error script
              </Button>
              <Button variant="ghost" size="sm" onClick={() => loadPreset("growing")}>
                Load chat script
              </Button>
            </div>
          </CardContent>
        </Card>

        <MockKeyEditor keys={keys} onChange={setKeys} />
        <ScriptEditor steps={steps} onChange={setSteps} />
      </div>

      {/* Results column */}
      <div className="space-y-4">
        {result ? (
          <TraceViewer result={result} />
        ) : (
          <Card>
            <CardContent className="p-10 text-center text-sm text-muted-foreground">
              Configure the pool and workload, then press{" "}
              <span className="font-medium text-foreground">Run scenario</span> to watch the
              caching-aware selector route, penalize, and inject.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
