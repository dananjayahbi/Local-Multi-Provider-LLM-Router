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
import { Loader2 } from "lucide-react";
import { ModelRow } from "./model-table";

interface Props {
  model: ModelRow | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

/** Edit an existing model (Models page): change model ID, display name,
 *  context window, and capabilities after the model has been listed. */
export function EditModelDialog({ model, onOpenChange, onSaved }: Props) {
  const [form, setForm] = useState(() =>
    model
      ? {
          modelId: model.modelId,
          displayName: model.displayName,
          supportsVision: model.supportsVision,
          supportsFunctionCalling: model.supportsFunctionCalling,
          contextWindow: model.contextWindow != null ? String(model.contextWindow) : "",
        }
      : {
          modelId: "",
          displayName: "",
          supportsVision: false,
          supportsFunctionCalling: false,
          contextWindow: "",
        }
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!model || !form.modelId.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/models/${model.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: form.modelId.trim(),
          displayName: form.displayName.trim(),
          supportsVision: form.supportsVision,
          supportsFunctionCalling: form.supportsFunctionCalling,
          contextWindow: form.contextWindow ? Number(form.contextWindow) : null,
        }),
      });
      if (res.ok) {
        onOpenChange(false);
        onSaved();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || "Save failed");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!model} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Model</DialogTitle>
          <DialogDescription>
            Update this model&apos;s details. Changes apply across pools using it.
          </DialogDescription>
        </DialogHeader>

        {model && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Model ID</Label>
                <Input
                  value={form.modelId}
                  onChange={(e) => setForm({ ...form, modelId: e.target.value })}
                  placeholder="e.g. gpt-4o"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Display Name</Label>
                <Input
                  value={form.displayName}
                  onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                  placeholder="e.g. GPT-4 Omni"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Context Window (tokens)</Label>
              <Input
                placeholder="e.g. 128000 (leave empty for ∞)"
                value={form.contextWindow}
                onChange={(e) => setForm({ ...form, contextWindow: e.target.value })}
              />
            </div>

            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.supportsVision}
                  onChange={(e) => setForm({ ...form, supportsVision: e.target.checked })}
                />
                Supports vision
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.supportsFunctionCalling}
                  onChange={(e) => setForm({ ...form, supportsFunctionCalling: e.target.checked })}
                />
                Function calling
              </label>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !form.modelId.trim()}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
