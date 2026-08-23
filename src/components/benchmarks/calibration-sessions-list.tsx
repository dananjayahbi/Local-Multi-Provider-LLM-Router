"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { History } from "lucide-react";
import type { CalibrationSession, CalibrationStatus } from "./calibration-types";

const STATUS_VARIANT: Record<CalibrationStatus, "default" | "warning" | "success" | "destructive"> =
  {
    PENDING: "warning",
    RUNNING: "default",
    COMPLETED: "success",
    FAILED: "destructive",
  };

/**
 * Recent calibration sessions history. Clicking a session selects
 * it for the findings / activity panels.
 */
export function CalibrationSessionsList({
  sessions,
  activeId,
  onSelect,
}: {
  sessions: CalibrationSession[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 text-muted-foreground" />
          Recent Sessions
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No calibration sessions yet.</p>
        ) : (
          <div className="space-y-2">
            {sessions.slice(0, 8).map((s) => (
              <button
                key={s.id}
                onClick={() => onSelect(s.id)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  activeId === s.id
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-muted"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">
                    {s.provider?.name || s.providerId}
                  </span>
                  <Badge variant={STATUS_VARIANT[s.status]}>{s.status}</Badge>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {s.providerModel?.displayName} · {s.apiKey?.label}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(s.createdAt).toLocaleString()}
                  {s.applied && <span className="ml-2 text-green-600">· applied</span>}
                </p>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
