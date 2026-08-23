"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Key,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  CircleCheck,
  AlertTriangle,
  Ban,
  CircleMinus,
  Box,
  Pencil,
  RefreshCw,
  Gauge,
  RotateCcw,
} from "lucide-react";

interface ApiKeyItem {
  id: string;
  label: string;
  status: string;
  secretEncrypted: string;
  penaltyLevel: number;
  penaltyExpiresAt: string | null;
  penaltyType: string | null;
  penaltyReason: string | null;
  suspendedReason: string | null;
  manuallyDisabled: boolean;
  consecutiveFailures: number;
  lastUsedAt: string | null;
  rpmLimit: number | null;
  tpmLimit: number | null;
  autoCalibration: boolean;
}

interface ProviderModelItem {
  id: string;
  modelId: string;
  displayName: string;
  supportsVision: boolean;
  supportsFunctionCalling: boolean;
  contextWindow: number | null;
  enabled: boolean;
}

interface ProviderDetail {
  id: string;
  name: string;
  baseUrl: string;
  apiFormat: string;
  notes: string | null;
}

function StatusChip({ status, penaltyLevel, penaltyExpiresAt, penaltyType, penaltyReason, suspendedReason }: {
  status: string;
  penaltyLevel: number;
  penaltyExpiresAt: string | null;
  penaltyType: string | null;
  penaltyReason: string | null;
  suspendedReason: string | null;
}) {
  if (status === "ACTIVE") {
    return <Badge variant="success"><CircleCheck className="mr-1 h-3 w-3" /> Active</Badge>;
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
        <AlertTriangle className="mr-1 h-3 w-3" />
        Penalized {typeLabel} ({mins}m {secs}s)
      </Badge>
    );
  }
  if (status === "SUSPENDED") {
    return <Badge variant="destructive"><Ban className="mr-1 h-3 w-3" /> {suspendedReason || "Suspended"}</Badge>;
  }
  return <Badge variant="outline"><CircleMinus className="mr-1 h-3 w-3" /> Disabled</Badge>;
}

export default function ProviderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [provider, setProvider] = useState<ProviderDetail | null>(null);
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [models, setModels] = useState<ProviderModelItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Key reveal
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

  // Dialogs
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [editKeyDialogOpen, setEditKeyDialogOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<ApiKeyItem | null>(null);

  const [keyForm, setKeyForm] = useState({ label: "", secret: "", rpmLimit: "", tpmLimit: "", autoCalibration: false });
  const [modelForm, setModelForm] = useState({
    modelId: "",
    displayName: "",
    supportsVision: false,
    supportsFunctionCalling: false,
    contextWindow: 0,
  });
  const [editKeyForm, setEditKeyForm] = useState({ label: "", secret: "", rpmLimit: "", tpmLimit: "", autoCalibration: false });

  const loadData = useCallback(async () => {
    const res = await fetch(`/api/admin/providers/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setProvider({
      id: data.id,
      name: data.name,
      baseUrl: data.baseUrl,
      apiFormat: data.apiFormat,
      notes: data.notes,
    });
    setKeys(data.apiKeys || []);
    setModels(data.providerModels || []);
    setLoading(false);
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  // Poll for status updates
  useEffect(() => {
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleAddKey = async () => {
    const rpmVal = keyForm.rpmLimit.trim() === "" ? null : parseInt(keyForm.rpmLimit, 10);
    const tpmVal = keyForm.tpmLimit.trim() === "" ? null : parseInt(keyForm.tpmLimit, 10);
    const res = await fetch(`/api/admin/providers/${id}/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: keyForm.label,
        secret: keyForm.secret,
        rpmLimit: rpmVal,
        tpmLimit: tpmVal,
        autoCalibration: keyForm.autoCalibration,
      }),
    });
    if (res.ok) {
      setKeyDialogOpen(false);
      setKeyForm({ label: "", secret: "", rpmLimit: "", tpmLimit: "", autoCalibration: false });
      loadData();
    }
  };

  const handleAddModel = async () => {
    const res = await fetch(`/api/admin/providers/${id}/models`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(modelForm),
    });
    if (res.ok) {
      setModelDialogOpen(false);
      setModelForm({ modelId: "", displayName: "", supportsVision: false, supportsFunctionCalling: false, contextWindow: 0 });
      loadData();
    }
  };

  const handleKeyAction = async (keyId: string, action: string) => {
    await fetch(`/api/admin/keys/${keyId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    loadData();
  };

  const handleDeleteKey = async (keyId: string) => {
    if (!confirm("Delete this API key?")) return;
    await fetch(`/api/admin/keys/${keyId}`, { method: "DELETE" });
    loadData();
  };

  const handleEditKey = async () => {
    if (!editingKey) return;
    const rpmVal = editKeyForm.rpmLimit.trim() === "" ? null : parseInt(editKeyForm.rpmLimit, 10);
    const tpmVal = editKeyForm.tpmLimit.trim() === "" ? null : parseInt(editKeyForm.tpmLimit, 10);
    const res = await fetch(`/api/admin/keys/${editingKey.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: editKeyForm.label || undefined,
        secret: editKeyForm.secret || undefined,
        rpmLimit: rpmVal,
        tpmLimit: tpmVal,
        autoCalibration: editKeyForm.autoCalibration,
      }),
    });
    if (res.ok) {
      setEditKeyDialogOpen(false);
      setEditingKey(null);
      loadData();
    }
  };

  const handleDeleteModel = async (modelId: string) => {
    if (!confirm("Delete this model?")) return;
    await fetch(`/api/admin/models/${modelId}`, { method: "DELETE" });
    loadData();
  };

  const toggleReveal = (keyId: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(keyId)) next.delete(keyId);
      else next.add(keyId);
      return next;
    });
  };

  if (loading) return <div className="text-muted-foreground">Loading...</div>;
  if (!provider) return <div className="text-muted-foreground">Provider not found.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push("/providers")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{provider.name}</h1>
          <div className="text-muted-foreground text-sm">
            {provider.baseUrl} • <Badge variant="outline" className="ml-1">{provider.apiFormat}</Badge>
          </div>
        </div>
      </div>

      {/* ─── Keys Section ─── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Key className="h-4 w-4" /> API Keys ({keys.length})
          </CardTitle>
          <Dialog open={keyDialogOpen} onOpenChange={setKeyDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="mr-1 h-3 w-3" /> Add Key</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add API Key</DialogTitle></DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label>Label</Label>
                  <Input value={keyForm.label} onChange={(e) => setKeyForm({ ...keyForm, label: e.target.value })} placeholder="e.g., Account 1" />
                </div>
                <div className="space-y-2">
                  <Label>API Key Secret</Label>
                  <Input value={keyForm.secret} onChange={(e) => setKeyForm({ ...keyForm, secret: e.target.value })} placeholder="sk-..." type="password" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>RPM Limit <span className="text-muted-foreground text-xs font-normal">(requests/min)</span></Label>
                    <Input
                      value={keyForm.rpmLimit}
                      onChange={(e) => setKeyForm({ ...keyForm, rpmLimit: e.target.value })}
                      placeholder="Unlimited"
                      type="number"
                      min="1"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>TPM Limit <span className="text-muted-foreground text-xs font-normal">(tokens/min)</span></Label>
                    <Input
                      value={keyForm.tpmLimit}
                      onChange={(e) => setKeyForm({ ...keyForm, tpmLimit: e.target.value })}
                      placeholder="Unlimited"
                      type="number"
                      min="1"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={keyForm.autoCalibration}
                    onChange={(e) => setKeyForm({ ...keyForm, autoCalibration: e.target.checked })}
                  />
                  Auto-calibration
                </label>
                <Button onClick={handleAddKey} className="w-full">Add Key</Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {keys.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No API keys yet. Add one to get started.</p>
          ) : (
            <div className="space-y-2">
              {keys.map((k) => (
                <div key={k.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{k.label}</span>
                      <StatusChip status={k.status} penaltyLevel={k.penaltyLevel} penaltyExpiresAt={k.penaltyExpiresAt} penaltyType={k.penaltyType} penaltyReason={k.penaltyReason} suspendedReason={k.suspendedReason} />
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>sk-••••{k.secretEncrypted ? k.secretEncrypted.slice(-4) : "????"}</span>
                      {revealedKeys.has(k.id) && (
                        <span className="font-mono text-xs bg-muted px-1 rounded">(encrypted in DB)</span>
                      )}
                      {(k.rpmLimit || k.tpmLimit) && (
                        <span className="flex items-center gap-1 ml-1">
                          <Gauge className="h-3 w-3" />
                          {k.rpmLimit ? `${k.rpmLimit} RPM` : ""}
                          {k.rpmLimit && k.tpmLimit ? " · " : ""}
                          {k.tpmLimit ? `${k.tpmLimit} TPM` : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {k.status === "SUSPENDED" && (
                      <Button size="sm" variant="outline" onClick={() => handleKeyAction(k.id, "reactivate")}>
                        <RefreshCw className="mr-1 h-3 w-3" /> Reactivate
                      </Button>
                    )}
                    {(k.status === "PENALIZED" || k.status === "SUSPENDED") && (
                      <Button size="sm" variant="outline" onClick={() => handleKeyAction(k.id, "reset-penalty")}>
                        <RotateCcw className="mr-1 h-3 w-3" /> Reset
                      </Button>
                    )}
                    {k.status !== "DISABLED" ? (
                      <Button size="sm" variant="outline" onClick={() => handleKeyAction(k.id, "disable")}>
                        <CircleMinus className="mr-1 h-3 w-3" /> Disable
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => handleKeyAction(k.id, "enable")}>
                        <CircleCheck className="mr-1 h-3 w-3" /> Enable
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => {
                      setEditingKey(k);
                      setEditKeyForm({
                        label: k.label,
                        secret: "",
                        rpmLimit: k.rpmLimit != null ? String(k.rpmLimit) : "",
                        tpmLimit: k.tpmLimit != null ? String(k.tpmLimit) : "",
                        autoCalibration: k.autoCalibration ?? false,
                      });
                      setEditKeyDialogOpen(true);
                    }}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDeleteKey(k.id)}>
                      <Trash2 className="h-3 w-3 text-red-500" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Models Section ─── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Box className="h-4 w-4" /> Models ({models.length})
          </CardTitle>
          <Dialog open={modelDialogOpen} onOpenChange={setModelDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="mr-1 h-3 w-3" /> Add Model</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Model</DialogTitle></DialogHeader>
              <div className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label>Model ID</Label>
                  <Input value={modelForm.modelId} onChange={(e) => setModelForm({ ...modelForm, modelId: e.target.value })} placeholder="e.g., gpt-4o" />
                </div>
                <div className="space-y-2">
                  <Label>Display Name</Label>
                  <Input value={modelForm.displayName} onChange={(e) => setModelForm({ ...modelForm, displayName: e.target.value })} placeholder="e.g., GPT-4 Omni" />
                </div>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={modelForm.supportsVision} onChange={(e) => setModelForm({ ...modelForm, supportsVision: e.target.checked })} />
                    Vision
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={modelForm.supportsFunctionCalling} onChange={(e) => setModelForm({ ...modelForm, supportsFunctionCalling: e.target.checked })} />
                    Function Calling
                  </label>
                </div>
                <div className="space-y-2">
                  <Label>Context Window (optional)</Label>
                  <Input type="number" value={modelForm.contextWindow || ""} onChange={(e) => setModelForm({ ...modelForm, contextWindow: parseInt(e.target.value) || 0 })} placeholder="e.g., 128000" />
                </div>
                <Button onClick={handleAddModel} className="w-full">Add Model</Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {models.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No models yet. Add the models this provider supports.</p>
          ) : (
            <div className="space-y-2">
              {models.map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{m.displayName}</span>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{m.modelId}</code>
                      {m.supportsVision && <Badge variant="outline" className="text-xs">👁 Vision</Badge>}
                      {m.supportsFunctionCalling && <Badge variant="outline" className="text-xs">🔧 Tools</Badge>}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => handleDeleteModel(m.id)}>
                    <Trash2 className="h-3 w-3 text-red-500" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Key Dialog */}
      <Dialog open={editKeyDialogOpen} onOpenChange={setEditKeyDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit API Key</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label>Label</Label>
              <Input value={editKeyForm.label} onChange={(e) => setEditKeyForm({ ...editKeyForm, label: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>New Secret (leave blank to keep current)</Label>
              <Input value={editKeyForm.secret} onChange={(e) => setEditKeyForm({ ...editKeyForm, secret: e.target.value })} placeholder="sk-..." type="password" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>RPM Limit <span className="text-muted-foreground text-xs font-normal">(requests/min)</span></Label>
                <Input
                  value={editKeyForm.rpmLimit}
                  onChange={(e) => setEditKeyForm({ ...editKeyForm, rpmLimit: e.target.value })}
                  placeholder="Unlimited"
                  type="number"
                  min="1"
                />
              </div>
              <div className="space-y-2">
                <Label>TPM Limit <span className="text-muted-foreground text-xs font-normal">(tokens/min)</span></Label>
                <Input
                  value={editKeyForm.tpmLimit}
                  onChange={(e) => setEditKeyForm({ ...editKeyForm, tpmLimit: e.target.value })}
                  placeholder="Unlimited"
                  type="number"
                  min="1"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={editKeyForm.autoCalibration}
                onChange={(e) => setEditKeyForm({ ...editKeyForm, autoCalibration: e.target.checked })}
              />
              Auto-calibration
            </label>
            <Button onClick={handleEditKey} className="w-full">Save Changes</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
