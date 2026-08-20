"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { PoolGatewayKey } from "@/components/pools/pool-gateway-key";
import { PoolKeysEditor, type ApiKey } from "@/components/pools/pool-keys-editor";
import { AddKeyDialog } from "@/components/pools/add-key-dialog";
import {
  ArrowLeft,
  Trash2,
  GripVertical,
  Pencil,
  Plus,
  ArrowUp,
  ArrowDown,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────

interface PoolMemberItem {
  id: string;
  priority: number;
  providerModel: {
    id: string;
    modelId: string;
    displayName: string;
    provider: {
      id: string;
      name: string;
    };
  };
}

interface PoolDetail {
  id: string;
  name: string;
  virtualModelName: string;
  description: string | null;
  routingStrategy: string;
  cacheAware: boolean;
  stickyContextTokenBudget: number;
  gatewayKey: string;
  gatewayKeyPrefix: string;
  poolMembers: PoolMemberItem[];
  apiKeys: ApiKey[];
}

interface ProviderOption { id: string; name: string }
interface ModelOption { id: string; displayName: string; modelId: string }

interface EditMemberRow {
  tempId: number;
  providerId: string;
  providerModelId: string;
  priority: number;
  existingMemberId?: string;
}

function newEditMember(priority: number): EditMemberRow {
  return { tempId: Date.now() + Math.random(), providerId: "", providerModelId: "", priority };
}

// ─── Page Component ─────────────────────────────────────

export default function PoolDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [pool, setPool] = useState<PoolDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  // Edit state
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editVirtualName, setEditVirtualName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStrategy, setEditStrategy] = useState("ROUND_ROBIN");
  const [editCacheAware, setEditCacheAware] = useState(true);
  const [editStickyBudget, setEditStickyBudget] = useState("0");
  const [editMembers, setEditMembers] = useState<EditMemberRow[]>([]);
  const [allProviders, setAllProviders] = useState<ProviderOption[]>([]);
  const [providerModels, setProviderModels] = useState<Record<string, ModelOption[]>>({});
  const [saving, setSaving] = useState(false);

  const loadPool = useCallback(async () => {
    const res = await fetch(`/api/admin/pools/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setPool(data);
    setLoading(false);
  }, [id]);

  useEffect(() => { loadPool(); }, [loadPool]);
  useEffect(() => {
    const interval = setInterval(loadPool, 5000);
    return () => clearInterval(interval);
  }, [loadPool]);

  const loadEditData = async () => {
    // Load providers and their models
    const pRes = await fetch("/api/admin/providers");
    const providers = await pRes.json();
    const provList = Array.isArray(providers) ? providers : [];
    setAllProviders(provList);

    const byProvider: Record<string, ModelOption[]> = {};
    for (const p of provList) {
      try {
        const mRes = await fetch(`/api/admin/providers/${p.id}/models`);
        const pModels = await mRes.json();
        byProvider[p.id] = Array.isArray(pModels) ? pModels : [];
      } catch {
        byProvider[p.id] = [];
      }
    }
    setProviderModels(byProvider);

    // Populate form from pool
    if (pool) {
      setEditName(pool.name);
      setEditVirtualName(pool.virtualModelName);
      setEditDescription(pool.description || "");
      setEditStrategy(pool.routingStrategy);
      setEditCacheAware(pool.cacheAware);
      setEditStickyBudget(String(pool.stickyContextTokenBudget ?? 0));
      setEditMembers(
        pool.poolMembers.map((m, i) => ({
          tempId: Date.now() + i,
          providerId: m.providerModel.provider.id,
          providerModelId: m.providerModel.id,
          priority: m.priority,
          existingMemberId: m.id,
        }))
      );
    }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this pool? This cannot be undone.")) return;
    await fetch(`/api/admin/pools/${id}`, { method: "DELETE" });
    router.push("/pools");
  };

  const handleRegenerateKey = async () => {
    setRegenerating(true);
    const res = await fetch(`/api/admin/pools/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "regenerate-key" }),
    });
    setRegenerating(false);
    if (res.ok) loadPool();
  };

  // ─── Edit members helpers ─────────────────────────────

  const addMember = () => setEditMembers((prev) => [...prev, newEditMember(prev.length)]);

  const removeMember = (tempId: number) => {
    if (editMembers.length <= 1) return;
    setEditMembers((prev) => {
      const filtered = prev.filter((m) => m.tempId !== tempId);
      return editStrategy === "PRIORITY"
        ? filtered.map((m, i) => ({ ...m, priority: i }))
        : filtered;
    });
  };

  const moveMember = (tempId: number, dir: -1 | 1) => {
    setEditMembers((prev) => {
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
    setEditMembers((prev) =>
      prev.map((m) => {
        if (m.tempId !== tempId) return m;
        if (field === "providerId") return { ...m, providerId: value, providerModelId: "" };
        return { ...m, providerModelId: value };
      })
    );
  };

  const handleSave = async () => {
    setSaving(true);
    const validMembers = editMembers.filter((m) => m.providerModelId);
    const res = await fetch(`/api/admin/pools/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editName,
        virtualModelName: editVirtualName,
        description: editDescription || undefined,
        routingStrategy: editStrategy,
        cacheAware: editCacheAware,
        stickyContextTokenBudget: parseInt(editStickyBudget, 10) || 0,
        members: validMembers.map((m) => ({
          providerModelId: m.providerModelId,
          priority: editStrategy === "PRIORITY" ? m.priority : 0,
        })),
      }),
    });
    setSaving(false);
    if (res.ok) {
      setEditOpen(false);
      loadPool();
    } else {
      const err = await res.json();
      alert(err.error || "Failed to update pool");
    }
  };

  if (loading) return <div className="text-muted-foreground">Loading...</div>;
  if (!pool) return <div className="text-muted-foreground">Pool not found.</div>;

  const apiKeys = pool.apiKeys || [];
  const healthyCount = apiKeys.filter((k) => k.status === "ACTIVE").length;
  const penalizedCount = apiKeys.filter((k) => k.status === "PENALIZED").length;
  const suspendedCount = apiKeys.filter((k) => k.status === "SUSPENDED").length;
  const disabledCount = apiKeys.filter((k) => k.status === "DISABLED").length;

  return (
    <div className="space-y-6">
      {/* ─── Header ─── */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push("/pools")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{pool.name}</h1>
          <p className="text-muted-foreground text-sm">
            Virtual model: <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{pool.virtualModelName}</code>
            {" • "}
            <Badge variant="outline">{pool.routingStrategy === "ROUND_ROBIN" ? "Round Robin" : pool.routingStrategy === "PRIORITY" ? "Priority" : "Key Aware"}</Badge>
            {pool.cacheAware && (
              <Badge variant="outline" className="ml-1">Cache Aware</Badge>
            )}
          </p>
        </div>

        {/* Edit Dialog */}
        <Dialog
          open={editOpen}
          onOpenChange={(open) => {
            setEditOpen(open);
            if (open) loadEditData();
          }}
        >
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Pencil className="mr-1 h-3 w-3" /> Edit Pool
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Edit Pool</DialogTitle></DialogHeader>
            <div className="space-y-5 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Pool Name</Label>
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Virtual Model Name</Label>
                  <Input value={editVirtualName} onChange={(e) => setEditVirtualName(e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="Optional..." />
              </div>
              <div className="space-y-2">
                <Label>Routing Strategy</Label>
                <Select value={editStrategy} onValueChange={setEditStrategy}>
                  <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ROUND_ROBIN">Round Robin</SelectItem>
                    <SelectItem value="PRIORITY">Priority</SelectItem>
                    <SelectItem value="KEY_AWARE">Key Aware</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Cache + sticky context */}
              <div className="grid grid-cols-2 gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editCacheAware}
                    onChange={(e) => setEditCacheAware(e.target.checked)}
                  />
                  Cache Aware
                </label>
                <div className="space-y-2">
                  <Label>Sticky Context Token Budget</Label>
                  <Input
                    value={editStickyBudget}
                    onChange={(e) => setEditStickyBudget(e.target.value)}
                    type="number"
                    min="0"
                    placeholder="0"
                  />
                </div>
              </div>

              {/* Members */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">
                    Members ({editMembers.filter((m) => m.providerModelId).length})
                  </Label>
                  <Button variant="outline" size="sm" onClick={addMember}>
                    <Plus className="mr-1 h-3 w-3" /> Add Member
                  </Button>
                </div>
                <div className="space-y-2">
                  {editMembers.map((member, idx) => {
                    const modelsForProvider = member.providerId ? providerModels[member.providerId] || [] : [];
                    const isOnly = editMembers.length === 1;
                    return (
                      <div key={member.tempId} className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3">
                        {editStrategy === "PRIORITY" && (
                          <div className="flex flex-col items-center gap-0.5 mr-1">
                            <button type="button" className="text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={idx === 0} onClick={() => moveMember(member.tempId, -1)}>
                              <ArrowUp className="h-3.5 w-3.5" />
                            </button>
                            <span className="text-xs font-mono text-muted-foreground w-5 text-center">{member.priority}</span>
                            <button type="button" className="text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={idx === editMembers.length - 1} onClick={() => moveMember(member.tempId, 1)}>
                              <ArrowDown className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                        {editStrategy !== "PRIORITY" && <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />}
                        <Select value={member.providerId} onValueChange={(v) => updateMember(member.tempId, "providerId", v)}>
                          <SelectTrigger className="flex-1 h-8 text-xs"><SelectValue placeholder="Provider..." /></SelectTrigger>
                          <SelectContent>
                            {allProviders.map((p) => (
                              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select value={member.providerModelId} onValueChange={(v) => updateMember(member.tempId, "providerModelId", v)} disabled={!member.providerId}>
                          <SelectTrigger className="flex-1 h-8 text-xs"><SelectValue placeholder="Model..." /></SelectTrigger>
                          <SelectContent>
                            {modelsForProvider.map((m) => (
                              <SelectItem key={m.id} value={m.id}>{m.displayName} ({m.modelId})</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={isOnly} onClick={() => removeMember(member.tempId)}>
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <Button onClick={handleSave} className="w-full" disabled={!editName || !editVirtualName || editMembers.filter((m) => m.providerModelId).length === 0 || saving}>
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Button variant="outline" size="sm" onClick={handleDelete}>
          <Trash2 className="mr-1 h-3 w-3 text-red-500" /> Delete
        </Button>
      </div>

      {/* ─── Health Summary ─── */}
      <div className="grid grid-cols-4 gap-4">
        <Card><CardContent className="pt-6 text-center"><div className="text-2xl font-bold text-green-500">{healthyCount}</div><p className="text-xs text-muted-foreground">Healthy</p></CardContent></Card>
        <Card><CardContent className="pt-6 text-center"><div className="text-2xl font-bold text-yellow-500">{penalizedCount}</div><p className="text-xs text-muted-foreground">Penalized</p></CardContent></Card>
        <Card><CardContent className="pt-6 text-center"><div className="text-2xl font-bold text-red-500">{suspendedCount}</div><p className="text-xs text-muted-foreground">Suspended</p></CardContent></Card>
        <Card><CardContent className="pt-6 text-center"><div className="text-2xl font-bold text-gray-400">{disabledCount}</div><p className="text-xs text-muted-foreground">Disabled</p></CardContent></Card>
      </div>

      {/* ─── Gateway Key ─── */}
      <PoolGatewayKey
        gatewayKey={pool.gatewayKey}
        gatewayKeyPrefix={pool.gatewayKeyPrefix}
        onRegenerate={handleRegenerateKey}
        regenerating={regenerating}
      />

      {/* ─── Pool Keys (top-level) ─── */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Pool Keys</h2>
        <AddKeyDialog poolId={pool.id} onCreated={loadPool} />
      </div>
      <PoolKeysEditor apiKeys={apiKeys} onChanged={loadPool} />

      {/* ─── Members ─── */}
      <h2 className="text-lg font-semibold">Members</h2>
      <div className="space-y-4">
        {pool.poolMembers.map((member) => (
          <Card key={member.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <GripVertical className="h-3 w-3 text-muted-foreground" />
                {member.providerModel.provider.name}
                <span className="text-muted-foreground">→</span>
                {member.providerModel.displayName}
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded ml-1">{member.providerModel.modelId}</code>
                {member.priority > 0 && <Badge variant="outline" className="ml-2">Priority {member.priority}</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Provider keys for this member are managed in the Pool Keys section above.
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
