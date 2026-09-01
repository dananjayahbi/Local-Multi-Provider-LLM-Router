"use client";

import { Badge } from "@/components/ui/badge";
import { CircleCheck, AlertTriangle, Ban, CircleMinus, FlaskConical, Timer } from "lucide-react";

interface KeyStatusBadgeProps {
  status: string;
  penaltyLevel: number;
  penaltyExpiresAt: string | null;
  penaltyType?: string | null;
  penaltyReason?: string | null;
  suspendedReason: string | null;
}

/** Renders a colored status badge for an API key, matching the existing provider-page pattern. */
export function KeyStatusBadge({
  status,
  penaltyLevel,
  penaltyExpiresAt,
  penaltyType,
  penaltyReason,
  suspendedReason,
}: KeyStatusBadgeProps) {
  if (status === "ACTIVE") {
    return (
      <Badge variant="success">
        <CircleCheck className="mr-1 h-3 w-3" /> Active
      </Badge>
    );
  }
  if (status === "PENALIZED") {
    const remaining = penaltyExpiresAt
      ? Math.max(0, Math.floor((new Date(penaltyExpiresAt).getTime() - Date.now()) / 1000))
      : 0;
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    const typeLabel =
      penaltyType === "PRE_DEFINED"
        ? `Pre-defined${penaltyReason ? ` · ${penaltyReason}` : ""}`
        : penaltyType === "VARIABLE"
          ? `Variable Lv.${penaltyLevel}`
          : `Lv.${penaltyLevel}`;
    return (
      <Badge variant="warning">
        <AlertTriangle className="mr-1 h-3 w-3" /> Penalized {typeLabel} ({mins}m {secs}s)
      </Badge>
    );
  }
  if (status === "SUSPENDED") {
    return (
      <Badge variant="destructive">
        <Ban className="mr-1 h-3 w-3" /> {suspendedReason || "Suspended"}
      </Badge>
    );
  }
  if (status === "TESTING") {
    return (
      <Badge variant="outline">
        <FlaskConical className="mr-1 h-3 w-3" /> Testing
      </Badge>
    );
  }
  if (status === "COOLDOWN") {
    return (
      <Badge variant="warning">
        <Timer className="mr-1 h-3 w-3" /> Cooldown
      </Badge>
    );
  }
  return (
    <Badge variant="outline">
      <CircleMinus className="mr-1 h-3 w-3" /> Disabled
    </Badge>
  );
}
