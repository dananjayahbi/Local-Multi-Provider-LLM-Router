"use client";

import { TerminalShell } from "@/components/terminal/terminal-shell";

/**
 * Hermes Terminal — a real command-prompt console for the Hermes
 * agent. No sessions, no chat UI: just the plain Hermes CLI
 * running in a live PTY, exactly as if launched from a terminal.
 */
export default function TerminalPage() {
  return (
    <div className="h-[calc(100vh-3rem)]">
      <TerminalShell />
    </div>
  );
}
