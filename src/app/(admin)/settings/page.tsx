"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Copy, RefreshCw, Eye, EyeOff, Save } from "lucide-react";
import { BenchmarkSettingsPanel } from "@/components/settings/benchmark-settings-panel";

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
  const [newKey, setNewKey] = useState<string | null>(null);
  const [showNewKey, setShowNewKey] = useState(false);

  const [form, setForm] = useState({
    penaltyBaseCooldownSeconds: 600,
    penaltyMultiplier: 3,
    penaltyMaxCooldownSeconds: 21600,
    penaltyResetWindowSeconds: 3600,
  });

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

  const handleRegenerateKey = async () => {
    if (!confirm("Regenerate the gateway key? The old key will stop working immediately.")) return;
    setNewKey(null);
    const res = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "regenerate-key" }),
    });
    const data = await res.json();
    setNewKey(data.plaintextKey);
    setShowNewKey(true);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  if (loading) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Gateway configuration and penalty engine tuning</p>
      </div>

      {/* Gateway Key */}
      <Card>
        <CardHeader>
          <CardTitle>Unified Gateway Key</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This is the key you paste into VS Code Copilot or any OpenAI-compatible client.
            Point your client to <code className="bg-muted px-1 py-0.5 rounded">http://localhost:4006/api/gateway/v1</code>
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-muted px-3 py-2 rounded text-sm">
              {settings?.gatewayKeyPrefix || "Not configured"}
            </code>
            <Button variant="outline" size="sm" onClick={handleRegenerateKey}>
              <RefreshCw className="mr-1 h-3 w-3" /> Regenerate
            </Button>
          </div>
          {newKey && (
            <div className="rounded-lg border-2 border-red-200 bg-red-50 dark:bg-red-950 p-4">
              <p className="text-sm font-bold text-red-600 dark:text-red-400 mb-2">
                ⚠️ Copy this key NOW. It will NOT be shown again!
              </p>
              <div className="flex items-center gap-2">
                <Input
                  value={showNewKey ? newKey : "••••••••••••••••••••••••••••••••"}
                  readOnly
                  className="font-mono"
                />
                <Button variant="outline" size="icon" onClick={() => setShowNewKey(!showNewKey)}>
                  {showNewKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button variant="outline" size="icon" onClick={() => copyToClipboard(newKey)}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Benchmark Engine Settings */}
      <BenchmarkSettingsPanel />

      {/* Penalty Engine Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Penalty Engine</CardTitle>
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

      {/* Server Info */}
      <Card>
        <CardHeader>
          <CardTitle>Server Info</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-2 text-sm">
            <span className="text-muted-foreground">Gateway Endpoint:</span>
            <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
              POST http://localhost:3000/api/gateway/v1/chat/completions
            </code>
          </div>
          <div className="grid grid-cols-2 text-sm">
            <span className="text-muted-foreground">VS Code Copilot Config:</span>
            <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
              &quot;chat.disableImplicitContext&quot;: true in Copilot settings
            </code>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
