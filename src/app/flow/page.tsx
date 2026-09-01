"use client";

import { Suspense } from "react";
import { useRouter } from "next/navigation";
import { X, Maximize2 } from "lucide-react";
import { FlowMeshCanvas } from "@/components/usage/flow-mesh-canvas";
import { FlowSummaryCards } from "@/components/usage/flow-summary-cards";
import { useLiveFlow } from "@/components/usage/use-live-flow";

/**
 * Fullscreen live data-flow view. Opened via the "Full Screen" button on
 * /usage; rendered OUTSIDE the admin sidebar so the mesh gets the whole
 * viewport. Reads the same persisted mesh key selection.
 */
function FullscreenFlow() {
  const router = useRouter();
  const { snapshot, connected } = useLiveFlow();
  const keysShown = snapshot.counts.byKey.length;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <Maximize2 className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Live Data Flow — Fullscreen</h1>
          <span className="text-xs text-muted-foreground">Real-time request distribution</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push("/usage")}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-muted"
          >
            <X className="h-4 w-4" />
            Close
          </button>
        </div>
      </header>

      <main className="flex-1 space-y-4 p-6">
        <FlowSummaryCards counts={snapshot.counts} connected={connected} keysShown={keysShown} />
        <FlowMeshCanvas
          storageKey="usage.mesh-key-ids"
          hidePicker={false}
          heightClass="h-[calc(100vh-240px)]"
        />
      </main>
    </div>
  );
}

export default function FlowPage() {
  return (
    <Suspense fallback={<div className="p-8 text-muted-foreground">Loading flow…</div>}>
      <FullscreenFlow />
    </Suspense>
  );
}
