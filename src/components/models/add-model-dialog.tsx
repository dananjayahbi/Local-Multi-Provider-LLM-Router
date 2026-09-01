"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";

interface ProviderOption {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: ProviderOption[];
  onCreated: () => void;
}

/** Manual model creation (task 07): add a model to an existing provider
 *  without going through the discovery agent. */
export function AddModelDialog({ open, onOpenChange, providers, onCreated }: Props) {
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [supportsVision, setSupportsVision] = useState(false);
  const [supportsFunctionCalling, setSupportsFunctionCalling] = useState(false);
  const [contextWindow, setContextWindow] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setProviderId("");
    setModelId("");
    setDisplayName("");
    setSupportsVision(false);
    setSupportsFunctionCalling(false);
    setContextWindow("");
  };

  const handleCreate = async () => {
    if (!providerId || !modelId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId,
          modelId,
          displayName,
          supportsVision,
          supportsFunctionCalling,
          contextWindow: contextWindow ? Number(contextWindow) : null,
        }),
      });
      if (res.ok) {
        onOpenChange(false);
        reset();
        onCreated();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Create failed");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Model</DialogTitle>
          <DialogDescription>
            Manually register a model on an existing provider. It will be available for pool
            creation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Provider</Label>
            <Select value={providerId} onValueChange={setProviderId}>
              <SelectTrigger>
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Model ID</Label>
              <Input
                placeholder="e.g. mimo-v2.5"
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Display Name</Label>
              <Input
                placeholder="e.g. MiMo v2.5"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Context Window (tokens)</Label>
            <Input
              placeholder="e.g. 32000 (leave empty for ∞)"
              value={contextWindow}
              onChange={(e) => setContextWindow(e.target.value)}
            />
          </div>

          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={supportsVision}
                onChange={(e) => setSupportsVision(e.target.checked)}
              />
              Supports vision
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={supportsFunctionCalling}
                onChange={(e) => setSupportsFunctionCalling(e.target.checked)}
              />
              Function calling
            </label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleCreate} disabled={saving || !providerId || !modelId}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Add Model
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
