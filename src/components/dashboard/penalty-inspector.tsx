"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RotateCcw, ShieldCheck, Loader2 } from "lucide-react";
import { PenaltyFilterBar } from "./penalty-filter-bar";

// ─── Types ──────────────────────────────────────────────

interface PenalizedKeyRow {
  id: string;
  label: string;
  status: string;
  penaltyLevel: number;
  penaltyType: string | null;
  penaltyReason: string | null;
  penaltyExpiresAt: string | null;
  providerName: string;
  models: string[];
  poolNames: string[];
}

interface PenaltyInspectorProps {
  /** Pre-loaded penalty rows (from the dashboard API). */
  penalties: PenalizedKeyRow[];
  providers: { id: string; name: string; models: { id: string; name: string }[] }[];
  /** Called after a successful reset so the parent can refresh / refetch. */
  onReset?: () => void;
}

function fmtRemaining(expiresAt: string | null): string {
  if (!expiresAt) return "—";
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m left`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m left`;
  return `${Math.floor(hrs / 24)}d left`;
}

/**
 * Penalty inspector: lists penalized / suspended keys (most recently applied
 * penalty first), with provider + model filters and a one-click Reset per row.
 */
export function PenaltyInspector({ penalties, providers, onReset }: PenaltyInspectorProps) {
  const [resetting, setResetting] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<{ providerId?: string; modelId?: string }>({});

  const filtered = useMemo(() => {
    return penalties.filter((p) => {
      if (filters.providerId && p.providerName !== providers.find((x) => x.id === filters.providerId)?.name) return false;
      if (filters.modelId) {
        const modelName = providers.flatMap((x) => x.models).find((m) => m.id === filters.modelId)?.name;
        if (modelName && !p.models.includes(modelName)) return false;
      }
      return true;
    });
  }, [penalties, filters, providers]);

  const reset = useCallback(
    async (id: string) => {
      setResetting((s) => new Set(s).add(id));
      try {
        await fetch(`/api/admin/keys/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reset-penalty" }),
        });
        onReset?.();
      } finally {
        setResetting((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
      }
    },
    [onReset]
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <CardTitle className="text-lg font-semibold">Penalized Keys</CardTitle>
            <Badge variant="secondary">{filtered.length}</Badge>
          </div>
          <PenaltyFilterBar providers={providers} onFilterChange={setFilters} />
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {filtered.length === 0 ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-green-500" />
            No penalized keys. All systems nominal.
          </div>
        ) : (
          filtered.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{p.label}</span>
                  <Badge variant={p.status === "SUSPENDED" ? "destructive" : "warning"}>
                    {p.status === "SUSPENDED" ? "Suspended" : `Lv.${p.penaltyLevel}`}
                  </Badge>
                  <span className="text-xs text-muted-foreground truncate">{p.providerName}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {p.penaltyReason && <span className="text-amber-600">{p.penaltyReason}</span>}
                  {p.models.length > 0 && <span>{p.models.join(", ")}</span>}
                  {p.poolNames.length > 0 && <span>· {p.poolNames.join(", ")}</span>}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {fmtRemaining(p.penaltyExpiresAt)}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => reset(p.id)}
                  disabled={resetting.has(p.id)}
                >
                  {resetting.has(p.id) ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RotateCcw className="mr-1 h-3 w-3" />}
                  Reset
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
