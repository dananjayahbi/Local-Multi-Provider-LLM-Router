// ─── Auto-Calibration Timeline ────────────────────────
// Timeline rendering of what the auto-calibrator observed & applied, per key.

import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  RefreshCcw,
} from "lucide-react";
import type { AutoCalibrationEvent, AutoCalibrationEventKind } from "./calibration-types";

interface CalibrationTimelineProps {
  events: AutoCalibrationEvent[];
  selectedKeyId: string | null;
}

const KIND_META: Record<
  AutoCalibrationEventKind,
  { label: string; icon: typeof AlertTriangle; className: string }
> = {
  FAILURE: { label: "Error", icon: AlertTriangle, className: "text-red-500 border-red-500/40" },
  SUCCESS: { label: "Success", icon: CheckCircle2, className: "text-green-500 border-green-500/40" },
  SCALE_DOWN: { label: "Scaled down", icon: ArrowDown, className: "text-amber-500 border-amber-500/40" },
  SCALE_UP: { label: "Scaled up", icon: ArrowUp, className: "text-lime-500 border-lime-500/40" },
  BASELINE_RESET: { label: "Baseline reset", icon: RefreshCcw, className: "text-green-500 border-green-500/40" },
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function limitsLine(
  limits: { rpmLimit?: number | null; tpmLimit?: number | null; rpdLimit?: number | null; tpdLimit?: number | null } | undefined
): string | null {
  if (!limits) return null;
  const parts: string[] = [];
  if (limits.rpmLimit != null) parts.push(`RPM ${limits.rpmLimit}`);
  if (limits.tpmLimit != null) parts.push(`TPM ${limits.tpmLimit}`);
  if (limits.rpdLimit != null) parts.push(`RPD ${limits.rpdLimit}`);
  if (limits.tpdLimit != null) parts.push(`TPD ${limits.tpdLimit}`);
  return parts.length ? parts.join(" · ") : null;
}

export function CalibrationTimeline({ events, selectedKeyId }: CalibrationTimelineProps) {
  if (events.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
        No auto-calibration activity yet. Enable Auto-cal on a key and route traffic
        through it to see the timeline here.
      </div>
    );
  }

  return (
    <ol className="relative space-y-4 pl-6">
      {/* vertical rail */}
      <span className="absolute left-[7px] top-0 h-full w-px bg-border" />
      {events.map((event) => {
        const meta = KIND_META[event.kind] ?? KIND_META.FAILURE;
        const Icon = meta.icon;
        const before = limitsLine(event.detail?.before);
        const after = limitsLine(event.detail?.after);
        const showDiff = event.kind === "SCALE_DOWN" || event.kind === "SCALE_UP";

        return (
          <li key={event.id} className="relative">
            <span
              className={`absolute -left-6 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border bg-background ${meta.className}`}
            >
              <Icon className="h-2 w-2" />
            </span>
            <div className="rounded-lg border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={`text-xs ${meta.className}`}>
                  <Icon className="mr-1 h-3 w-3" /> {meta.label}
                </Badge>
                {event.key && (
                  <span className="text-xs font-medium">{event.key.label}</span>
                )}
                {event.limit && (
                  <Badge variant="secondary" className="text-xs">
                    {event.limit}
                  </Badge>
                )}
                <time className="ml-auto text-xs text-muted-foreground">
                  {formatTime(event.createdAt)}
                </time>
              </div>

              <p className="mt-1.5 text-sm">{event.message}</p>

              {showDiff && (before || after) && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded bg-muted/40 p-2 text-xs font-mono">
                  {before && (
                    <span className="text-muted-foreground line-through">{before}</span>
                  )}
                  <ArrowDown className="h-3 w-3 text-amber-500" />
                  <span className="text-foreground">{after}</span>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
