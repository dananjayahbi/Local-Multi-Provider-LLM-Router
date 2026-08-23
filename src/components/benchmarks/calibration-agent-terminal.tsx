"use client";

import dynamic from "next/dynamic";
import { Terminal as TerminalIcon } from "lucide-react";

// xterm.js touches the DOM at import time, so it must never run
// during SSR. Load it client-only, mirroring the /terminal page.
const HermesTerminal = dynamic(
  () => import("@/components/terminal/hermes-terminal").then((m) => m.HermesTerminal),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-black font-mono text-sm text-green-500">
        <span className="animate-pulse">▌ connecting to Hermes terminal…</span>
      </div>
    ),
  }
);

/**
 * The on-page Hermes terminal shown on the benchmarks page. It
 * connects to the same persistent PTY as the /terminal page, so the
 * user sees the calibration auto-picker (and any manual `hermes`
 * work) live.
 */
export function CalibrationAgentTerminal() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border">
      <div className="flex items-center gap-2 border-b bg-muted px-3 py-2">
        <TerminalIcon className="h-4 w-4 text-green-500" />
        <span className="text-xs font-medium text-muted-foreground">
          hermes — agent activity
        </span>
      </div>
      <div className="min-h-0 flex-1 bg-black">
        <HermesTerminal />
      </div>
    </div>
  );
}
