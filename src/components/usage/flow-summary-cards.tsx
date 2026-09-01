"use client";

import { Card, CardContent } from "@/components/ui/card";
import { ArrowRightLeft, Timer, Layers } from "lucide-react";
import type { FlowCounts } from "./use-live-flow";
import { cn } from "@/lib/utils";

interface FlowSummaryCardsProps {
  counts: FlowCounts;
  connected: boolean;
  keysShown: number;
}

/**
 * Compact real-time header over the animation: how many requests the gateway
 * is HOLDING (queued) vs IN FLIGHT, plus a live/connected indicator.
 */
export function FlowSummaryCards({ counts, connected, keysShown }: FlowSummaryCardsProps) {
  const heldPct = counts.total > 0 ? Math.round((counts.held / counts.total) * 100) : 0;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Card>
        <CardContent className="flex items-center gap-3 py-3">
          <div className={cn("flex h-9 w-9 items-center justify-center rounded-md bg-muted", counts.held > 0 && "bg-amber-100 text-amber-700")}>
            <Timer className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-medium">
              {counts.held} held
              <span className="ml-1.5 text-xs text-muted-foreground">({heldPct}%)</span>
            </p>
            <p className="text-[11px] text-muted-foreground">Requests queued in gateway</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-center gap-3 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
            <ArrowRightLeft className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-medium">{counts.inFlight} in flight</p>
            <p className="text-[11px] text-muted-foreground">Requests calling providers</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-center gap-3 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
            <Layers className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-medium">{keysShown} key{keysShown === 1 ? "" : "s"} tracked</p>
            <p className="text-[11px] text-muted-foreground">
              {connected ? (
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> live
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" /> connecting…
                </span>
              )}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
