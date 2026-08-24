"use client";

import { useState } from "react";
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
} from "@/components/ui/dialog";
import { CopyButton } from "@/components/pools/copy-button";
import { KeyStatusBadge } from "@/components/pools/key-status-badge";
import { ManualPenaltyDialog } from "@/components/keys/manual-penalty-dialog";
import { KeyLimitsFields, emptyKeyLimitsForm, keyLimitsFromApiKey, keyLimitsToPayload, type KeyLimitsForm } from "@/components/pools/key-limits-fields";
import {
  Key,
  RefreshCw,
  RotateCcw,
  CircleMinus,
  CircleCheck,
  Pencil,
  Trash2,
  Gauge,
  Sparkles,
  Unlink,
} from "lucide-react";

/** Full ApiKey shape as returned by the backend. */
export interface ApiKey {
  id: string;
  poolId: string | null;
  providerId: string;
  label: string;
  secret: string;
  rpmLimit: number | null;
  tpmLimit: number | null;
  rpdLimit: number | null;
  tpdLimit: number | null;
  tps: number | null;
  timeToFirstTokenMs: number | null;
  contextWindow: number | null;
  cacheCapable: boolean;
  cacheDiscountFactor: number;
  status: string;
  penaltyLevel: number;
  penaltyExpiresAt: string | null;
  penaltyType: string | null;
  penaltyReason: string | null;
  suspendedReason: string | null;
  calibrated: boolean;
  autoCalibration: boolean;
  provider: { id: string; name: string; baseUrl: string; apiFormat: string };
}

interface PoolKeysEditorProps {
  apiKeys: ApiKey[];
  /** Pool the keys are attached to (for detach). */
  poolId: string;
  /** Called after any mutation so the parent can re-fetch the pool. */
  onChanged: () => void;
}

export function PoolKeysEditor({ apiKeys, poolId, onChanged }: PoolKeysEditorProps) {
  const [editing, setEditing] = useState<ApiKey | null>(null);
  const [editForm, setEditForm] = useState<{ label: string; secret: string }>({ label: "", secret: "" });
  const [editLimits, setEditLimits] = useState<KeyLimitsForm>(emptyKeyLimitsForm());
  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const runAction = async (keyId: string, action: string) => {
    await fetch(`/api/admin/keys/${keyId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    onChanged();
  };

  // Keys are provider-level and SHARED across pools (task 05), so removing
  // one from this pool detaches it rather than deleting it globally.
  const handleDetach = async (key: ApiKey) => {
    if (!confirm(`Detach key "${key.label}" from this pool? The key stays available for other pools.`)) return;
    await fetch(`/api/admin/pools/${poolId}/keys?apiKeyId=${key.id}`, { method: "DELETE" });
    onChanged();
  };

  const openEdit = (key: ApiKey) => {
    setEditing(key);
    setEditForm({ label: key.label, secret: key.secret });
    setEditLimits(keyLimitsFromApiKey(key));
    setEditOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    const res = await fetch(`/api/admin/keys/${editing.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: editForm.label,
        secret: editForm.secret,
        ...keyLimitsToPayload(editLimits),
      }),
    });
    setBusy(false);
    if (res.ok) {
      setEditOpen(false);
      setEditing(null);
      onChanged();
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Key className="h-4 w-4" /> Pool API Keys ({apiKeys.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {apiKeys.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No keys assigned to this pool yet. Add one below.
          </p>
        ) : (
          <div className="space-y-2">
            {apiKeys.map((k) => (
              <div key={k.id} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{k.label}</span>
                    <Badge variant="outline">{k.provider.name}</Badge>
                    {k.calibrated && (
                      <Badge variant="secondary" className="text-xs">
                        <Sparkles className="mr-1 h-3 w-3" /> Calibrated
                      </Badge>
                    )}
                    {k.autoCalibration && (
                      <Badge variant="outline" className="text-xs border-lime-500 text-lime-600">
                        <Gauge className="mr-1 h-3 w-3" /> Auto-cal
                      </Badge>
                    )}
                    <KeyStatusBadge
                      status={k.status}
                      penaltyLevel={k.penaltyLevel}
                      penaltyExpiresAt={k.penaltyExpiresAt}
                      penaltyType={k.penaltyType}
                      penaltyReason={k.penaltyReason}
                      suspendedReason={k.suspendedReason}
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    {k.status === "SUSPENDED" && (
                      <Button size="sm" variant="outline" onClick={() => runAction(k.id, "reactivate")}>
                        <RefreshCw className="mr-1 h-3 w-3" /> Reactivate
                      </Button>
                    )}
                    {(k.status === "PENALIZED" || k.status === "SUSPENDED") && (
                      <Button size="sm" variant="outline" onClick={() => runAction(k.id, "reset-penalty")}>
                        <RotateCcw className="mr-1 h-3 w-3" /> Reset
                      </Button>
                    )}
                    <ManualPenaltyDialog apiKey={k} onChanged={onChanged} />
                    {k.status !== "DISABLED" ? (
                      <Button size="sm" variant="outline" onClick={() => runAction(k.id, "disable")}>
                        <CircleMinus className="mr-1 h-3 w-3" /> Disable
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => runAction(k.id, "enable")}>
                        <CircleCheck className="mr-1 h-3 w-3" /> Enable
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => openEdit(k)}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDetach(k)} title="Detach from this pool">
                      <Unlink className="h-3 w-3 text-red-500" />
                    </Button>
                  </div>
                </div>

                {/* Secret — always plaintext + copyable */}
                <div className="flex items-center gap-2 rounded border bg-muted/40 px-2 py-1">
                  <span className="text-xs text-muted-foreground shrink-0">Secret</span>
                  <code className="flex-1 break-all font-mono text-xs">{k.secret}</code>
                  <CopyButton value={k.secret} className="shrink-0 h-6 w-6" />
                </div>

                {/* Limits */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Gauge className="h-3 w-3" />
                    {k.rpmLimit ?? "∞"} RPM
                  </span>
                  <span>{k.tpmLimit ?? "∞"} TPM</span>
                  <span>{k.rpdLimit ?? "∞"} RPD</span>
                  <span>{k.tpdLimit ?? "∞"} TPD</span>
                  {k.tps != null && <span>{k.tps} TPS</span>}
                  {k.timeToFirstTokenMs != null && <span>{k.timeToFirstTokenMs}ms TTFT</span>}
                  {k.contextWindow != null && <span>ctx {k.contextWindow}</span>}
                  {k.cacheCapable && (
                    <Badge variant="outline" className="text-[10px]">cache ×{k.cacheDiscountFactor}</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* Edit Key Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit API Key</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Label</Label>
                <Input value={editForm.label} onChange={(e) => setEditForm({ ...editForm, label: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Secret</Label>
                <Input value={editForm.secret} onChange={(e) => setEditForm({ ...editForm, secret: e.target.value })} placeholder="sk-..." />
              </div>
            </div>
            <KeyLimitsFields value={editLimits} onChange={setEditLimits} />
            <Button onClick={handleSaveEdit} className="w-full" disabled={busy}>
              {busy ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
