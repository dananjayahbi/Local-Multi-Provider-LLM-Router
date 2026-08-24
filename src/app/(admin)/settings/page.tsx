"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Save, Server, Clock, Info } from "lucide-react";
import { CopyButton } from "@/components/pools/copy-button";
import { gatewayBaseUrl } from "@/lib/gateway-url";

interface SettingsData {
  gatewayKeyPrefix: string;
  penaltyBaseCooldownSeconds: number;
  penaltyMultiplier: number;
  penaltyMaxCooldownSeconds: number;
  penaltyResetWindowSeconds: number;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    penaltyBaseCooldownSeconds: 600,
    penaltyMultiplier: 3,
    penaltyMaxCooldownSeconds: 21600,
    penaltyResetWindowSeconds: 3600,
  });

  // Compute the base URL client-side so it reflects the active host.
  const [baseUrl, setBaseUrl] = useState("");
  useEffect(() => {
    setBaseUrl(gatewayBaseUrl());
  }, []);

  const loadSettings = async () => {
    const res = await fetch("/api/admin/settings");
    const data = await res.json();
    setSettings(data);
    setForm({
      penaltyBaseCooldownSeconds: data.penaltyBaseCooldownSeconds,
      penaltyMultiplier: data.penaltyMultiplier,
      penaltyMaxCooldownSeconds: data.penaltyMaxCooldownSeconds,
      penaltyResetWindowSeconds: data.penaltyResetWindowSeconds,
    });
    setLoading(false);
  };

  useEffect(() => { loadSettings(); }, []);

  const handleSave = async () => {
    setSaving(true);
    await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    loadSettings();
  };

  if (loading) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Gateway endpoint and penalty engine tuning</p>
      </div>

      {/* Gateway Endpoint */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-4 w-4" /> Gateway Endpoint
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Point your OpenAI-compatible client (e.g. VS Code Copilot) at this base URL and use
            the pool&apos;s gateway key for authentication.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-muted px-3 py-2 rounded text-sm break-all">{baseUrl}</code>
            <CopyButton value={baseUrl} />
          </div>
        </CardContent>
      </Card>

      {/* Penalty Engine Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4" /> Penalty Engine
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Base Cooldown (seconds)</Label>
              <Input
                type="number"
                value={form.penaltyBaseCooldownSeconds}
                onChange={(e) => setForm({ ...form, penaltyBaseCooldownSeconds: parseInt(e.target.value) || 0 })}
              />
              <p className="text-xs text-muted-foreground">Default: 600 (10 minutes). First-offense penalty duration.</p>
            </div>
            <div className="space-y-2">
              <Label>Multiplier</Label>
              <Input
                type="number"
                step="0.1"
                value={form.penaltyMultiplier}
                onChange={(e) => setForm({ ...form, penaltyMultiplier: parseFloat(e.target.value) || 0 })}
              />
              <p className="text-xs text-muted-foreground">Default: 3. Escalation factor per repeat offense.</p>
            </div>
            <div className="space-y-2">
              <Label>Max Cooldown (seconds)</Label>
              <Input
                type="number"
                value={form.penaltyMaxCooldownSeconds}
                onChange={(e) => setForm({ ...form, penaltyMaxCooldownSeconds: parseInt(e.target.value) || 0 })}
              />
              <p className="text-xs text-muted-foreground">Default: 21600 (6 hours). Upper cap.</p>
            </div>
            <div className="space-y-2">
              <Label>Reset Window (seconds)</Label>
              <Input
                type="number"
                value={form.penaltyResetWindowSeconds}
                onChange={(e) => setForm({ ...form, penaltyResetWindowSeconds: parseInt(e.target.value) || 0 })}
              />
              <p className="text-xs text-muted-foreground">Default: 3600 (1 hour). Sustained health before reset.</p>
            </div>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? "Saving..." : "Save Settings"}
          </Button>
        </CardContent>
      </Card>

      {/* Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-4 w-4" /> Info
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="grid grid-cols-2">
            <span className="text-muted-foreground">VS Code Copilot Config:</span>
            <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
              &quot;chat.disableImplicitContext&quot;: true
            </code>
          </div>
          <div className="grid grid-cols-2">
            <span className="text-muted-foreground">Auth:</span>
            <span className="text-xs">Use a pool&apos;s gateway key (see Pools → Gateway Key)</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
