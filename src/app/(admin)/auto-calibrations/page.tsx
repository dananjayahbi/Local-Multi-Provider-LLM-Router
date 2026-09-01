"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, Activity } from "lucide-react";
import { KeyStateCard } from "@/components/calibrations/key-state-card";
import { CalibrationTimeline } from "@/components/calibrations/calibration-timeline";
import type {
  AutoCalibrationData,
  AutoCalibrationEvent,
} from "@/components/calibrations/calibration-types";

const POLL_INTERVAL_MS = 10_000;

export default function AutoCalibrationsPage() {
  const [data, setData] = useState<AutoCalibrationData>({ events: [], keys: [] });
  const [loading, setLoading] = useState(true);
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/auto-calibrations");
      if (!res.ok) return;
      const json = await res.json();
      setData(json);
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  // Default selection: first auto-calibrated key, so the timeline isn't empty.
  useEffect(() => {
    if (!selectedKeyId && data.keys.length > 0) {
      setSelectedKeyId(data.keys[0].id);
    }
  }, [data.keys, selectedKeyId]);

  const selectedEvents: AutoCalibrationEvent[] = selectedKeyId
    ? data.events.filter((e) => e.key.id === selectedKeyId)
    : data.events;

  const selectedKey = data.keys.find((k) => k.id === selectedKeyId) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Auto Calibrations</h1>
          <p className="text-muted-foreground text-sm">
            Timeline of automatic limit adjustments per auto-calibrated key.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="mr-1 h-3 w-3" /> Refresh
        </Button>
      </div>

      {loading ? (
        <div className="text-muted-foreground">Loading...</div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* ─── Left: auto-calibrated keys with applied limits ─── */}
          <div className="space-y-4 lg:col-span-1">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Auto-calibrated Keys</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.keys.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    No keys have auto-calibration enabled.
                  </p>
                ) : (
                  data.keys.map((k) => (
                    <KeyStateCard
                      key={k.id}
                      keyInfo={k}
                      selected={k.id === selectedKeyId}
                      onSelect={() => setSelectedKeyId(k.id)}
                    />
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          {/* ─── Right: timeline for the selected key ─── */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Activity className="h-4 w-4" />
                  {selectedKey ? `${selectedKey.label} — Timeline` : "Timeline"}
                </CardTitle>
              </CardHeader>
              <CardContent className="py-4">
                <CalibrationTimeline
                  events={selectedEvents}
                  selectedKeyId={selectedKeyId}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
