"use client";

import { useMemo } from "react";
import { Workflow, Maximize2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLiveFlow, FlowEvent } from "./use-live-flow";
import { FlowSummaryCards } from "./flow-summary-cards";
import { FlowMeshCanvas } from "./flow-mesh-canvas";

/**
 * The live data-flow illustration. Renders a radial mesh (net) whose center is
 * the gateway + client (Copilot) and whose spokes are providers/keys carrying
 * per-request dots. Sits ABOVE the chart section on /usage.
 */
export function LiveDataFlow() {
  const { snapshot, connected } = useLiveFlow();
  const keysShown = snapshot.counts.byKey.length;

  // Open the mesh in a dedicated fullscreen tab (no sidebar, full viewport).
  const openFullscreen = () => {
    window.open("/flow", "_blank", "noopener,noreferrer");
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Workflow className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-lg font-semibold">Live Data Flow</CardTitle>
            <span className="text-xs text-muted-foreground">Real-time request distribution</span>
          </div>
          <button
            type="button"
            onClick={openFullscreen}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors hover:bg-muted"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            Full Screen
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <FlowSummaryCards counts={snapshot.counts} connected={connected} keysShown={keysShown} />
        <FlowMeshCanvas storageKey="usage.mesh-key-ids" />

        {snapshot.events.length > 0 && <FlowEventTail events={snapshot.events} />}
      </CardContent>
    </Card>
  );
}

// ─── Event Tail ─────────────────────────────────────────
// A compact, always-fresh list of the most recent pipeline transitions.

function FlowEventTail({ events }: { events: FlowEvent[] }) {
  const recent = useMemo(() => [...events].reverse().slice(0, 8), [events]);

  if (recent.length === 0) return null;

  const stageColor: Record<string, string> = {
    arrived: "bg-sky-500",
    queued: "bg-amber-500",
    assigned: "bg-indigo-500",
    success: "bg-emerald-500",
    failed: "bg-red-500",
  };

  return (
    <div className="border-t pt-3">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Recent transitions
      </p>
      <ul className="space-y-1 text-xs">
        {recent.map((e) => (
          <li key={e.id} className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${stageColor[e.stage] ?? "bg-muted-foreground"}`} />
            <span className="font-medium">{e.apiKeyLabel ?? "Gateway"}</span>
            <span className="text-muted-foreground">→ {e.stage}</span>
            <span className="ml-auto tabular-nums text-muted-foreground">
              {new Date(e.ts).toLocaleTimeString("en-US", { hour12: false })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
