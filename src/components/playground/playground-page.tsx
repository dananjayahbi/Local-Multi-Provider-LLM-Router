"use client";

// ─── Playground Page ───────────────────────────────────
// Task 09 experiment surface. Two labs:
//   • Algorithm Simulator — prove the caching-aware selector,
//     scaled penalties, and rotation against mock providers.
//   • Injection Lab — craft the Copilot askQuestion guidance.

import { useState } from "react";
import { cn } from "@/lib/utils";
import { AlgorithmSimulator } from "./algorithm-simulator";
import { InjectionLab } from "./injection-lab";

type Tab = "simulator" | "injection";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "simulator", label: "Algorithm Simulator" },
  { id: "injection", label: "Copilot Injection Lab" },
];

export function PlaygroundPage() {
  const [tab, setTab] = useState<Tab>("simulator");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Playground</h1>
        <p className="text-sm text-muted-foreground">
          Experimental harness for the multi-key-pool routing redesign (design doc 06). Prove the
          algorithm and injection against mocks before production wiring.
        </p>
      </div>

      <div className="flex gap-1 rounded-lg border bg-muted/40 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              tab === t.id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "simulator" ? <AlgorithmSimulator /> : <InjectionLab />}
    </div>
  );
}
