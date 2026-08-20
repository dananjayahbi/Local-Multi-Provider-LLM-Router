"use client";

// ─── Trace Viewer ──────────────────────────────────────
// Renders the outcome of a scenario run: summary stats, the full
// decision trace (route / penalty / injection / note), and each
// key's final state.

import { KeyUsage, ScenarioResult, TraceEvent } from "@/engine/playground";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  result: ScenarioResult;
}

const KIND_STYLE: Record<TraceEvent["kind"], string> = {
  route: "bg-primary/10 text-primary",
  penalty: "bg-destructive/10 text-destructive",
  injection: "bg-amber-500/10 text-amber-600",
  note: "bg-muted text-muted-foreground",
};

function fmtTokens(n: number): string {
  return n.toLocaleString();
}

function fmtSeconds(ms: number): string {
  return `${Math.round(ms / 1000)}s`;
}

export function TraceViewer({ result }: Props) {
  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      ACTIVE: "bg-emerald-500/10 text-emerald-600",
      PENALIZED: "bg-destructive/10 text-destructive",
      SUSPENDED: "bg-orange-500/10 text-orange-600",
      DISABLED: "bg-muted text-muted-foreground",
    };
    return map[status] ?? "bg-muted text-muted-foreground";
  };

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
          <Stat label="Steps" value={String(result.trace.filter((t) => t.kind === "route").length)} />
          <Stat label="Rotations" value={String(result.rotationCount)} />
          <Stat label="Cache saved" value={fmtTokens(result.cachedTokensSaved)} />
          <Stat label="Prompt tokens" value={fmtTokens(result.totalPromptTokens)} />
        </CardContent>
      </Card>

      {/* Key final states */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Key states</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {result.keys.map((k) => {
            const u: KeyUsage | undefined = result.usage[k.id];
            return (
              <div key={k.id} className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="secondary" className={statusBadge(k.status)}>
                  {k.status}
                </Badge>
                <span className="font-medium">{k.label}</span>
                <span className="text-muted-foreground">
                  served {fmtTokens(u?.totalTokensServed ?? 0)} · cached {fmtTokens(u?.cachedTokensSaved ?? 0)}
                  {k.status === "PENALIZED" && k.penaltyExpiresAt
                    ? ` · penalized until ${new Date(k.penaltyExpiresAt).toLocaleTimeString()}`
                    : ""}
                </span>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Trace */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Decision trace</CardTitle>
        </CardHeader>
        <CardContent className="max-h-[28rem] space-y-2 overflow-y-auto">
          {result.trace.length === 0 && (
            <p className="text-sm text-muted-foreground">Run the scenario to see the trace.</p>
          )}
          {result.trace.map((t, i) => (
            <div key={i} className="flex gap-2 text-xs">
              <span className="mt-0.5 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                #{t.step}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className={KIND_STYLE[t.kind]}>
                    {t.kind}
                  </Badge>
                  <span className="truncate font-medium">{t.message}</span>
                </div>
                {t.detail && (
                  <pre className="mt-1 whitespace-pre-wrap rounded bg-muted/50 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                    {t.detail}
                  </pre>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/40 p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
