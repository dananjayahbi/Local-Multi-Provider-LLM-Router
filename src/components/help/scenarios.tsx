"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MermaidDiagram } from "./mermaid-diagram";
import { SCENARIOS, type ScenarioBlock } from "./help-content";

type LevelFilter = "all" | ScenarioBlock["level"];

const LEVELS: { value: LevelFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "basic", label: "Basic" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
];

const LEVEL_STYLE: Record<ScenarioBlock["level"], string> = {
  basic: "outline",
  intermediate: "secondary",
  advanced: "default",
};

/** The scenarios section: a filterable list of end-to-end walkthroughs with diagrams. */
export function Scenarios() {
  const [filter, setFilter] = useState<LevelFilter>("all");

  const filtered = useMemo(
    () => (filter === "all" ? SCENARIOS : SCENARIOS.filter((s) => s.level === filter)),
    [filter]
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Scenarios</h2>
        <p className="text-muted-foreground">
          End-to-end walkthroughs of the router&apos;s behavior across common situations, from
          simple successes to complex failover and caching decisions. Use the filters to focus.
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2">
        {LEVELS.map((lv) => (
          <Button
            key={lv.value}
            size="sm"
            variant={filter === lv.value ? "default" : "outline"}
            onClick={() => setFilter(lv.value)}
          >
            {lv.label}
          </Button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-1">
        {filtered.map((scenario) => (
          <ScenarioCard key={scenario.id} scenario={scenario} />
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-sm text-muted-foreground">No scenarios in this category.</p>
      )}
    </div>
  );
}

function ScenarioCard({ scenario }: { scenario: ScenarioBlock }) {
  return (
    <Card id={scenario.id}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{scenario.title}</CardTitle>
          <LevelBadge level={scenario.level} />
        </div>
        <p className="text-sm text-muted-foreground">{scenario.summary}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <MermaidDiagram chart={scenario.chart} />

        <div className="space-y-2">
          <p className="text-sm font-semibold">Walkthrough</p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            {scenario.walkthrough.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>

        <div className="rounded-lg border-l-4 border-green-500 bg-green-50 dark:bg-green-950/30 p-3">
          <p className="text-sm">
            <span className="font-semibold text-green-700 dark:text-green-400">Outcome: </span>
            <span className="text-green-800 dark:text-green-300">{scenario.outcome}</span>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function LevelBadge({ level }: { level: ScenarioBlock["level"] }) {
  const label = level.charAt(0).toUpperCase() + level.slice(1);
  return <Badge variant={LEVEL_STYLE[level] as "outline" | "secondary" | "default"}>{label}</Badge>;
}
