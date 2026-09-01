// ─── Auto-Calibration Key State Card ──────────────────
// Shows one auto-calibrated key's current applied parameters + live state.

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Key, Gauge, Timer, Zap } from "lucide-react";
import type { AutoCalibrationKey } from "./calibration-types";
import { cn } from "@/lib/utils";

interface KeyStateCardProps {
  keyInfo: AutoCalibrationKey;
  selected: boolean;
  onSelect: () => void;
}

function limitLabel(value: number | null, suffix: string): string {
  return value == null ? `∞ ${suffix}` : `${value} ${suffix}`;
}

export function KeyStateCard({ keyInfo: k, selected, onSelect }: KeyStateCardProps) {
  const streak = k.autoCalibrationState?.consecutiveSuccesses ?? 0;
  const statusBadge =
    k.status === "ACTIVE" ? (
      <Badge variant="success">Active</Badge>
    ) : k.status === "PENALIZED" ? (
      <Badge variant="warning">Penalized Lv.{k.penaltyLevel}</Badge>
    ) : (
      <Badge variant="outline">{k.status}</Badge>
    );

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      className={cn(
        "cursor-pointer transition-all",
        selected && "ring-2 ring-primary"
      )}
    >
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Key className="h-4 w-4" />
          {k.label}
          <Badge variant="outline" className="ml-auto text-xs">
            {k.provider.name}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          {statusBadge}
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Timer className="h-3 w-3" /> streak {streak}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1">
            <Gauge className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">RPM</span>
            <span className="ml-auto font-mono">{limitLabel(k.rpmLimit, "")}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Zap className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">TPM</span>
            <span className="ml-auto font-mono">{limitLabel(k.tpmLimit, "")}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Gauge className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">RPD</span>
            <span className="ml-auto font-mono">{limitLabel(k.rpdLimit, "")}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Zap className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">TPD</span>
            <span className="ml-auto font-mono">{limitLabel(k.tpdLimit, "")}</span>
          </span>
        </div>

        {k.tps != null && (
          <p className="text-xs text-muted-foreground">Speed: {k.tps} tokens/sec</p>
        )}
      </CardContent>
    </Card>
  );
}
