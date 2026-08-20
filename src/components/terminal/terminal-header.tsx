"use client";

import { Terminal as TerminalIcon } from "lucide-react";

/**
 * A slim status bar shown above the Hermes terminal, mirroring a
 * terminal window title bar. Purely presentational.
 */
export function TerminalHeader({ title = "hermes — terminal" }: { title?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-t-md border border-b-0 border-border bg-neutral-900 px-3 py-2">
      <TerminalIcon className="h-4 w-4 text-green-500" />
      <span className="text-sm font-semibold text-neutral-300">{title}</span>
      <span className="ml-auto flex items-center gap-1 text-xs text-neutral-500">
        <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
        live
      </span>
    </div>
  );
}
