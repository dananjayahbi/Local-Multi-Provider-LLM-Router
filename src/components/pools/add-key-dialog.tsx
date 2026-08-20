"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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
import { KeyLimitsFields, emptyKeyLimitsForm, keyLimitsToPayload, type KeyLimitsForm } from "@/components/pools/key-limits-fields";
import { Plus, Link2 } from "lucide-react";

interface ProviderOption { id: string; name: string }

interface AllKey {
  id: string;
  label: string;
  provider: { id: string; name: string };
}

interface AddKeyDialogProps {
  poolId: string;
  /** Keys already attached to this pool, so they can be hidden from the attach list. */
  existingKeyIds?: string[];
  /** Called after a key is successfully added so the parent can reload. */
  onCreated: () => void;
}

type Mode = "create" | "attach";

/** Add a provider key to a pool. Two modes (task 05):
 *  * create — create a NEW provider-level key (shared across pools) + attach it
 *  * attach — attach an EXISTING provider-level key to this pool (sharing it) */
export function AddKeyDialog({ poolId, existingKeyIds = [], onCreated }: AddKeyDialogProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("create");

  // create mode
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [providerId, setProviderId] = useState("");
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [limits, setLimits] = useState<KeyLimitsForm>(emptyKeyLimitsForm());

  // attach mode
  const [allKeys, setAllKeys] = useState<AllKey[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [pRes, kRes] = await Promise.all([
        fetch("/api/admin/providers"),
        fetch("/api/admin/keys"),
      ]);
      const providers = await pRes.json();
      const keys = await kRes.json();
      if (cancelled) return;
      setProviders(Array.isArray(providers) ? providers : []);
      setAllKeys(Array.isArray(keys) ? keys : []);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const reset = () => {
    setMode("create");
    setProviderId("");
    setLabel("");
    setSecret("");
    setLimits(emptyKeyLimitsForm());
    setSelected(new Set());
  };

  const handleCreate = async () => {
    if (!providerId || !label || !secret) return;
    setSubmitting(true);
    const res = await fetch(`/api/admin/providers/${providerId}/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, secret, poolId, ...keyLimitsToPayload(limits) }),
    });
    setSubmitting(false);
    if (res.ok) {
      setOpen(false);
      reset();
      onCreated();
    } else {
      const err = await res.json();
      alert(err.error || "Failed to add key");
    }
  };

  const handleAttach = async () => {
    setSubmitting(true);
    for (const apiKeyId of selected) {
      await fetch(`/api/admin/pools/${poolId}/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKeyId }),
      });
    }
    setSubmitting(false);
    setOpen(false);
    reset();
    onCreated();
  };

  const attachable = allKeys.filter((k) => !existingKeyIds.includes(k.id));
  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-3 w-3" /> Add Key to Pool
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Add Key to Pool</DialogTitle></DialogHeader>

        {/* Mode toggle */}
        <div className="flex gap-2 pt-2">
          <Button variant={mode === "create" ? "default" : "outline"} size="sm" onClick={() => setMode("create")}>
            Create new key
          </Button>
          <Button variant={mode === "attach" ? "default" : "outline"} size="sm" onClick={() => setMode("attach")}>
            <Link2 className="mr-1 h-3 w-3" /> Attach existing
          </Button>
        </div>

        {mode === "create" ? (
          <div className="space-y-4 pt-4">
            <p className="text-xs text-muted-foreground">
              Creates a provider-level key (shared across pools, task 05) and attaches it to this pool.
            </p>
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select value={providerId} onValueChange={setProviderId}>
                <SelectTrigger><SelectValue placeholder="Select a provider..." /></SelectTrigger>
                <SelectContent>
                  {providers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Label</Label>
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g., Account 1" />
              </div>
              <div className="space-y-2">
                <Label>Secret</Label>
                <Input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="sk-..." />
              </div>
            </div>
            <KeyLimitsFields value={limits} onChange={setLimits} />
            <Button onClick={handleCreate} className="w-full" disabled={!providerId || !label || !secret || submitting}>
              {submitting ? "Adding..." : "Create & Attach"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4 pt-4">
            <p className="text-xs text-muted-foreground">
              Attach an existing provider-level key to this pool, sharing it (and its penalty) across pools.
            </p>
            {attachable.length === 0 ? (
              <p className="text-sm text-muted-foreground">No unattached keys available.</p>
            ) : (
              <div className="space-y-1.5">
                {attachable.map((k) => (
                  <label key={k.id} className="flex cursor-pointer items-center justify-between rounded-md border px-3 py-2">
                    <div>
                      <span className="text-sm font-medium">{k.label}</span>
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{k.provider.name}</span>
                    </div>
                    <input type="checkbox" checked={selected.has(k.id)} onChange={() => toggle(k.id)} />
                  </label>
                ))}
              </div>
            )}
            <Button onClick={handleAttach} className="w-full" disabled={selected.size === 0 || submitting}>
              {submitting ? "Attaching..." : `Attach${selected.size > 0 ? ` (${selected.size})` : ""}`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
