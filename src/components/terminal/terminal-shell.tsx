"use client";

import dynamic from "next/dynamic";
import { TerminalHeader } from "./terminal-header";

// xterm.js touches the DOM at import time, so it must never run
// during SSR. Load it client-only.
const HermesTerminal = dynamic(
  () => import("./hermes-terminal").then((m) => m.HermesTerminal),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-black font-mono text-sm text-green-500">
        <span className="animate-pulse">▌ starting Hermes terminal…</span>
      </div>
    ),
  }
);

/**
 * The full Hermes terminal view: a window-style header above a
 * real PTY-backed xterm.js console.
 */
export function TerminalShell() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TerminalHeader title="hermes — terminal" />
      <div className="min-h-0 flex-1 rounded-b-md border border-border bg-black">
        <HermesTerminal />
      </div>
    </div>
  );
}
