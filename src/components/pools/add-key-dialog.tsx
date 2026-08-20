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
import { Plus } from "lucide-react";

interface ProviderOption {
  id: string;
  name: string;
}

interface AddKeyDialogProps {
  poolId: string;
  /** Called after a key is successfully created so the parent can reload. */
  onCreated: () => void;
}

/** Dialog to add a provider key to a pool (POST /api/admin/providers/[id]/keys with poolId). */
export function AddKeyDialog({ poolId, onCreated }: AddKeyDialogProps) {
  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [providerId, setProviderId] = useState("");
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [limits, setLimits] = useState<KeyLimitsForm>(emptyKeyLimitsForm());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/admin/providers");
      const data = await res.json();
      if (!cancelled) setProviders(Array.isArray(data) ? data : []);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const reset = () => {
    setProviderId("");
    setLabel("");
    setSecret("");
    setLimits(emptyKeyLimitsForm());
  };

  const handleSubmit = async () => {
    if (!providerId || !label || !secret) return;
    setSubmitting(true);
    const res = await fetch(`/api/admin/providers/${providerId}/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label,
        secret,
        poolId,
        ...keyLimitsToPayload(limits),
      }),
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
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add Key to Pool</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-4">
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
          <Button onClick={handleSubmit} className="w-full" disabled={!providerId || !label || !secret || submitting}>
            {submitting ? "Adding..." : "Add Key"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
