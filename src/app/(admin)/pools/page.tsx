"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CopyButton } from "@/components/pools/copy-button";
import {
  Plus,
  Layers,
  CircleCheck,
  ChevronRight,
  Zap,
  Trash2,
  GripVertical,
  ArrowUp,
  ArrowDown,
  KeyRound,
  RefreshCw,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────

interface PoolItem {
  id: string;
  name: string;
  virtualModelName: string;
  routingStrategy: string;
  gatewayKey: string;
  gatewayKeyPrefix: string;
  _count: { poolMembers: number };
  healthyKeys: number;
  totalKeys: number;
}

interface ProviderOption {
  id: string;
  name: string;
}

interface ModelOption {
  id: string;
  displayName: string;
  modelId: string;
  supportsVision: boolean;
  supportsFunctionCalling: boolean;
  provider: { id: string; name: string };
}

interface MemberRow {
  tempId: number;
  providerId: string;
  providerModelId: string;
  priority: number;
}

// ─── Page Component ─────────────────────────────────────

export default function PoolsPage() {
  const router = useRouter();
  const [pools, setPools] = useState<PoolItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [mode, setMode] = useState<"quick" | "advanced">("quick");

  // Quick-mode form
  const [quickForm, setQuickForm] = useState({
    providerModelId: "",
    virtualModelName: "",
  });
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);

  // Advanced-mode form
  const [advName, setAdvName] = useState("");
  const [advVirtualName, setAdvVirtualName] = useState("");
  const [advDescription, setAdvDescription] = useState("");
  const [advStrategy, setAdvStrategy] = useState("ROUND_ROBIN");
  const [members, setMembers] = useState<MemberRow[]>([newMember(0)]);
  const [allProviders, setAllProviders] = useState<ProviderOption[]>([]);
  const [providerModels, setProviderModels] = useState<Record<string, ModelOption[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);

  function newMember(priority: number): MemberRow {
    return { tempId: Date.now() + Math.random(), providerId: "", providerModelId: "", priority };
  }

  // ─── Data Loading ─────────────────────────────────────

  const loadPools = useCallback(async () => {
    const res = await fetch("/api/admin/pools");
    const data = await res.json();
    setPools(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  const loadAllData = useCallback(async () => {
    // Load providers
    const pRes = await fetch("/api/admin/providers");
    const providers = await pRes.json();
    const provList = Array.isArray(providers) ? providers : [];
    setAllProviders(provList);

    // Load all models into a flat list (for quick mode) and keyed by provider (for advanced)
    const flat: ModelOption[] = [];
    const byProvider: Record<string, ModelOption[]> = {};
    for (const p of provList) {
      try {
        const mRes = await fetch(`/api/admin/providers/${p.id}/models`);
        const pModels = await mRes.json();
        const models = (Array.isArray(pModels) ? pModels : []).map((m: Record<string, unknown>) => ({
          ...m,
          provider: { id: p.id, name: p.name },
        }));
        byProvider[p.id] = models as ModelOption[];
        flat.push(...(models as ModelOption[]));
      } catch {
        byProvider[p.id] = [];
      }
    }
    setAvailableModels(flat);
    setProviderModels(byProvider);
  }, []);

  useEffect(() => { loadPools(); }, [loadPools]);
  useEffect(() => {
    const interval = setInterval(loadPools, 10000);
    return () => clearInterval(interval);
  }, [loadPools]);

  // ─── Handlers ─────────────────────────────────────────

  const handleRegenerate = async (poolId: string) => {
    setRegeneratingId(poolId);
    const res = await fetch(`/api/admin/pools/${poolId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "regenerate-key" }),
    });
    setRegeneratingId(null);
    if (res.ok) loadPools();
  };

  const resetForms = () => {
    setQuickForm({ providerModelId: "", virtualModelName: "" });
    setAdvName("");
    setAdvVirtualName("");
    setAdvDescription("");
    setAdvStrategy("ROUND_ROBIN");
    setMembers([newMember(0)]);
    setMode("quick");
  };

  const handleQuickCreate = async () => {
    const res = await fetch("/api/admin/pools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quickMode: true,
        providerModelId: quickForm.providerModelId,
        virtualModelName: quickForm.virtualModelName,
      }),
    });
    if (res.ok) {
      setCreateOpen(false);
      resetForms();
      loadPools();
    }
  };

  const handleAdvancedCreate = async () => {
    setSubmitting(true);
    const validMembers = members.filter((m) => m.providerModelId);
    const res = await fetch("/api/admin/pools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: advName,
        virtualModelName: advVirtualName,
        description: advDescription || undefined,
        routingStrategy: advStrategy,
        members: validMembers.map((m) => ({
          providerModelId: m.providerModelId,
          priority: advStrategy === "PRIORITY" ? m.priority : 0,
        })),
      }),
    });
    setSubmitting(false);
    if (res.ok) {
      setCreateOpen(false);
      resetForms();
      loadPools();
    } else {
      const err = await res.json();
      alert(err.error || "Failed to create pool");
    }
  };

  // ─── Members Helpers ──────────────────────────────────

  const addMember = () => setMembers((prev) => [...prev, newMember(prev.length)]);

  const removeMember = (tempId: number) => {
    if (members.length <= 1) return;
    setMembers((prev) => {
      const filtered = prev.filter((m) => m.tempId !== tempId);
      return advStrategy === "PRIORITY"
        ? filtered.map((m, i) => ({ ...m, priority: i }))
        : filtered;
    });
  };

  const moveMember = (tempId: number, dir: -1 | 1) => {
    setMembers((prev) => {
      const idx = prev.findIndex((m) => m.tempId === tempId);
      if (idx === -1) return prev;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return arr.map((m, i) => ({ ...m, priority: i }));
    });
  };

  const updateMember = (tempId: number, field: "providerId" | "providerModelId", value: string) => {
    setMembers((prev) =>
      prev.map((m) => {
        if (m.tempId !== tempId) return m;
        if (field === "providerId") return { ...m, providerId: value, providerModelId: "" };
        return { ...m, providerModelId: value };
      })
    );
  };

  // ─── Render ───────────────────────────────────────────

  if (loading) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pools</h1>
          <p className="text-muted-foreground">Manage routing pools and virtual model names</p>
        </div>

        <Dialog
          open={createOpen}
          onOpenChange={(open) => {
            setCreateOpen(open);
            if (open) loadAllData();
            else resetForms();
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> Create Pool
            </Button>
          </DialogTrigger>

          <DialogContent className={mode === "advanced" ? "max-w-2xl max-h-[85vh] overflow-y-auto" : "max-w-md"}>
            <DialogHeader>
              <DialogTitle>Create Pool</DialogTitle>
            </DialogHeader>

            {/* ─── Mode Toggle ─── */}
            <div className="flex gap-2">
              <Button
                variant={mode === "quick" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("quick")}
              >
                <Zap className="mr-1 h-3 w-3" /> Quick
              </Button>
              <Button
                variant={mode === "advanced" ? "default" : "outline"}
                size="sm"
                onClick={() => setMode("advanced")}
              >
                <Layers className="mr-1 h-3 w-3" /> Advanced
              </Button>
            </div>

            {/* ─── QUICK MODE ─── */}
            {mode === "quick" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Provider Model</Label>
                  <Select
                    value={quickForm.providerModelId}
                    onValueChange={(v) => setQuickForm({ ...quickForm, providerModelId: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a model..." />
                    </SelectTrigger>
                    <SelectContent>
                      {availableModels.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.provider.name} / {m.displayName} ({m.modelId})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Virtual Model Name</Label>
                  <Input
                    value={quickForm.virtualModelName}
                    onChange={(e) => setQuickForm({ ...quickForm, virtualModelName: e.target.value })}
                    placeholder="e.g., my-default-model"
                  />
                  <p className="text-xs text-muted-foreground">
                    Clients put this name in the <code>model</code> field of their requests.
                  </p>
                </div>
                <Button onClick={handleQuickCreate} className="w-full" disabled={!quickForm.providerModelId || !quickForm.virtualModelName}>
                  Create Quick Pool
                </Button>
              </div>
            )}

            {/* ─── ADVANCED MODE ─── */}
            {mode === "advanced" && (
              <div className="space-y-5">
                {/* Pool metadata */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Pool Name *</Label>
                    <Input
                      value={advName}
                      onChange={(e) => setAdvName(e.target.value)}
                      placeholder="e.g., Vision Models Pool"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Virtual Model Name *</Label>
                    <Input
                      value={advVirtualName}
                      onChange={(e) => setAdvVirtualName(e.target.value)}
                      placeholder="e.g., vision-pool"
                    />
                    <p className="text-xs text-muted-foreground">
                      Clients put this name in the <code>model</code> field.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Description</Label>
                  <Input
                    value={advDescription}
                    onChange={(e) => setAdvDescription(e.target.value)}
                    placeholder="Optional description..."
                  />
                </div>

                <div className="space-y-2">
                  <Label>Routing Strategy</Label>
                  <Select value={advStrategy} onValueChange={setAdvStrategy}>
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ROUND_ROBIN">Round Robin</SelectItem>
                      <SelectItem value="PRIORITY">Priority</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {advStrategy === "ROUND_ROBIN"
                      ? "Keys are ordered least-recently-used first, spreading load evenly."
                      : "Keys are ordered by priority (lower = tried first), then least-recently-used."}
                  </p>
                </div>

                {/* ─── Members ─── */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-semibold">
                      Pool Members ({members.filter((m) => m.providerModelId).length})
                    </Label>
                    <Button variant="outline" size="sm" onClick={addMember}>
                      <Plus className="mr-1 h-3 w-3" /> Add Member
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {members.map((member, idx) => {
                      const modelsForProvider = member.providerId
                        ? providerModels[member.providerId] || []
                        : [];
                      const isOnly = members.length === 1;

                      return (
                        <div
                          key={member.tempId}
                          className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3"
                        >
                          {/* Priority controls */}
                          {advStrategy === "PRIORITY" && (
                            <div className="flex flex-col items-center gap-0.5 mr-1">
                              <button
                                type="button"
                                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                                disabled={idx === 0}
                                onClick={() => moveMember(member.tempId, -1)}
                              >
                                <ArrowUp className="h-3.5 w-3.5" />
                              </button>
                              <span className="text-xs font-mono text-muted-foreground w-5 text-center">
                                {member.priority}
                              </span>
                              <button
                                type="button"
                                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                                disabled={idx === members.length - 1}
                                onClick={() => moveMember(member.tempId, 1)}
                              >
                                <ArrowDown className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}

                          {advStrategy !== "PRIORITY" && (
                            <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}

                          {/* Provider select */}
                          <Select
                            value={member.providerId}
                            onValueChange={(v) => updateMember(member.tempId, "providerId", v)}
                          >
                            <SelectTrigger className="flex-1 h-8 text-xs">
                              <SelectValue placeholder="Provider..." />
                            </SelectTrigger>
                            <SelectContent>
                              {allProviders.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          {/* Model select */}
                          <Select
                            value={member.providerModelId}
                            onValueChange={(v) => updateMember(member.tempId, "providerModelId", v)}
                            disabled={!member.providerId}
                          >
                            <SelectTrigger className="flex-1 h-8 text-xs">
                              <SelectValue placeholder="Model..." />
                            </SelectTrigger>
                            <SelectContent>
                              {modelsForProvider.map((m) => (
                                <SelectItem key={m.id} value={m.id}>
                                  <span className="flex items-center gap-1.5">
                                    {m.displayName}
                                    <code className="text-[10px] bg-muted px-1 rounded">{m.modelId}</code>
                                    {m.supportsVision && <span className="text-[10px]">👁</span>}
                                    {m.supportsFunctionCalling && <span className="text-[10px]">🔧</span>}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          {/* Remove */}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            disabled={isOnly}
                            onClick={() => removeMember(member.tempId)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Submit */}
                <Button
                  onClick={handleAdvancedCreate}
                  className="w-full"
                  disabled={
                    !advName ||
                    !advVirtualName ||
                    members.filter((m) => m.providerModelId).length === 0 ||
                    submitting
                  }
                >
                  {submitting ? "Creating..." : "Create Advanced Pool"}
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {/* ─── Pool List ─── */}
      {pools.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Layers className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground">No pools configured yet.</p>
            <p className="text-sm text-muted-foreground">Create your first pool to start routing requests.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {pools.map((p) => (
            <Card
              key={p.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => router.push(`/pools/${p.id}`)}
            >
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="font-semibold">{p.name}</div>
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{p.virtualModelName}</code>
                  </div>
                  <Badge variant="outline">{p._count.poolMembers === 1 ? "Simple" : "Unified"}</Badge>
                </div>
                <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-2 py-1 mb-3">
                  <KeyRound className="h-3 w-3 text-muted-foreground shrink-0" />
                  <code className="flex-1 break-all font-mono text-xs">{p.gatewayKey}</code>
                  <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                    <CopyButton value={p.gatewayKey} className="h-6 w-6 shrink-0" />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0"
                      title="Regenerate gateway key"
                      disabled={regeneratingId === p.id}
                      onClick={() => handleRegenerate(p.id)}
                    >
                      <RefreshCw className={`h-3 w-3 ${regeneratingId === p.id ? "animate-spin" : ""}`} />
                    </Button>
                  </div>
                </div>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1">
                      <CircleCheck className="h-3 w-3 text-green-500" /> {p.healthyKeys}
                    </span>
                    <span>/ {p.totalKeys} keys healthy</span>
                  </div>
                  <Badge variant="outline">{p.routingStrategy === "ROUND_ROBIN" ? "Round Robin" : "Priority"}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
