"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MermaidDiagram } from "./mermaid-diagram";
import { SYSTEM_OVERVIEW } from "./help-content";

/** The "How It Works" section: system architecture, engines, and algorithms. */
export function ArchitectureOverview() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight">How It Works</h2>
        <p className="text-muted-foreground">
          The router is an OpenAI-compatible proxy that sits between your clients and many upstream
          LLM providers. Every request flows through a single gateway, gets routed to the best
          healthy key, and is normalized back to a standard response.
        </p>
      </div>

      <div className="space-y-4">
        {SYSTEM_OVERVIEW.map((block) => (
          <Card key={block.title}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{block.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <MermaidDiagram chart={block.chart} caption={block.caption} />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Key concepts table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Core Concepts</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Concept</th>
                  <th className="py-2 pr-4 font-medium">What it means</th>
                  <th className="py-2 font-medium">Where it lives</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <CoreConceptRow
                  term="Pool"
                  desc="A named virtual model that maps to one or more provider models + keys. Clients call the pool by its virtualModelName."
                  loc="Pool model, /pools"
                />
                <CoreConceptRow
                  term="Virtual Model Name"
                  desc="The model string a client sends (e.g. Ox-Alpha-R). Resolves to a pool for routing."
                  loc="Pool.virtualModelName"
                />
                <CoreConceptRow
                  term="Provider-Level Key"
                  desc="A credential owned by a provider, shared into multiple pools via PoolApiKey. Penalties/limits propagate across pools."
                  loc="ApiKey + PoolApiKey"
                />
                <CoreConceptRow
                  term="Penalty"
                  desc="A timed exclusion of a key (PRE_DEFINED for known limits, VARIABLE for generic errors). Key is not routable until it expires."
                  loc="health-engine.ts"
                />
                <CoreConceptRow
                  term="Auto-Calibration"
                  desc="Automatically scales a key's limits up on success and down on throttle to find its sustainable ceiling, capped by hard max limits."
                  loc="benchmark/auto-calibration.ts"
                />
                <CoreConceptRow
                  term="Cache-Aware Routing"
                  desc="Prefers staying on a key to preserve the provider prompt-cache discount (cache ×0.1)."
                  loc="playground/selector.ts"
                />
                <CoreConceptRow
                  term="Exhausted Pool"
                  desc="No routable key remains. The gateway returns a 200 predefined message so an autonomous agent ends its turn instead of retrying."
                  loc="routing/exhausted-pool.ts"
                />
                <CoreConceptRow
                  term="Manual Penalty"
                  desc="Operators can force a penalty by level or custom timer from the UI."
                  loc="manual-penalty.ts"
                />
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Routing Strategy Comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <StrategyCard
              name="Round Robin"
              desc="Cycles through keys deterministically. Simple, good for equivalent keys."
              tag="simple"
            />
            <StrategyCard
              name="Priority"
              desc="Orders by member priority (lowest first). Good when you prefer a primary key."
              tag="simple"
            />
            <StrategyCard
              name="Key Aware"
              desc="Full scoring: stickiness, exhaustability, context-fit, rotation cost, speed. Best for heterogeneous keys / caching."
              tag="advanced"
              recommended
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CoreConceptRow({ term, desc, loc }: { term: string; desc: string; loc: string }) {
  return (
    <tr>
      <td className="py-2 pr-4 font-medium">{term}</td>
      <td className="py-2 pr-4 text-muted-foreground">{desc}</td>
      <td className="py-2">
        <Badge variant="outline" className="font-mono text-[10px]">{loc}</Badge>
      </td>
    </tr>
  );
}

function StrategyCard({
  name,
  desc,
  tag,
  recommended,
}: {
  name: string;
  desc: string;
  tag: "simple" | "advanced";
  recommended?: boolean;
}) {
  return (
    <div className="rounded-lg border p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-sm">{name}</span>
        <Badge variant={tag === "advanced" ? "secondary" : "outline"}>
          {tag === "advanced" ? "Advanced" : "Simple"}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">{desc}</p>
      {recommended && <Badge variant="success" className="text-[10px]">Recommended</Badge>}
    </div>
  );
}
