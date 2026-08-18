"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Save } from "lucide-react";

interface BenchmarkConfig {
  baselineProviderModelId: string | null;
  targetTps: number;
  targetRpm: number;
  ttftDriftThreshold: number;
  tpsDriftThreshold: number;
  postTestCooldownSeconds: number;
  maxParallelTests: number;
}

export function BenchmarkSettingsPanel() {
  const [config, setConfig] = useState<BenchmarkConfig | null>(null);
  const [saving, setSaving] = useState(false);

  const loadConfig = async () => {
    const res = await fetch("/api/admin/settings");
    const data = await res.json();
    if (data.benchmark) setConfig(data.benchmark);
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ benchmark: config }),
      });
    } finally {
      setSaving(false);
    }
  };

  if (!config) return null;

  const set = (key: keyof BenchmarkConfig, value: number | string | null) =>
    setConfig({ ...config, [key]: value });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Benchmark Engine</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Target TPS</Label>
            <Input
              type="number"
              step="0.1"
              value={config.targetTps}
              onChange={(e) => set("targetTps", parseFloat(e.target.value) || 0)}
            />
            <p className="text-xs text-muted-foreground">Default: 60. Early-stopping ceiling.</p>
          </div>
          <div className="space-y-2">
            <Label>Target RPM</Label>
            <Input
              type="number"
              value={config.targetRpm}
              onChange={(e) => set("targetRpm", parseInt(e.target.value) || 0)}
            />
            <p className="text-xs text-muted-foreground">Default: 15. Request rate threshold.</p>
          </div>
          <div className="space-y-2">
            <Label>TTFT Drift Threshold</Label>
            <Input
              type="number"
              step="0.1"
              value={config.ttftDriftThreshold}
              onChange={(e) => set("ttftDriftThreshold", parseFloat(e.target.value) || 0)}
            />
            <p className="text-xs text-muted-foreground">Default: 2.5× baseline.</p>
          </div>
          <div className="space-y-2">
            <Label>TPS Drift Threshold</Label>
            <Input
              type="number"
              step="0.1"
              value={config.tpsDriftThreshold}
              onChange={(e) => set("tpsDriftThreshold", parseFloat(e.target.value) || 0)}
            />
            <p className="text-xs text-muted-foreground">Default: 2.0× baseline.</p>
          </div>
          <div className="space-y-2">
            <Label>Post-Test Cooldown (seconds)</Label>
            <Input
              type="number"
              value={config.postTestCooldownSeconds}
              onChange={(e) => set("postTestCooldownSeconds", parseInt(e.target.value) || 0)}
            />
            <p className="text-xs text-muted-foreground">Default: 120 (2 minutes).</p>
          </div>
          <div className="space-y-2">
            <Label>Max Parallel Tests</Label>
            <Input
              type="number"
              value={config.maxParallelTests}
              onChange={(e) => set("maxParallelTests", parseInt(e.target.value) || 1)}
            />
            <p className="text-xs text-muted-foreground">Default: 3. Global concurrency limit.</p>
          </div>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          <Save className="mr-2 h-4 w-4" />
          {saving ? "Saving..." : "Save Benchmark Settings"}
        </Button>
      </CardContent>
    </Card>
  );
}
