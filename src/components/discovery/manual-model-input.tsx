"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import { CuratedModel } from "./discovery-types";

interface Props {
  onAdd: (model: CuratedModel) => void;
  disabled?: boolean;
}

const EMPTY = {
  modelId: "",
  displayName: "",
  contextWindow: "",
};

/** Manual model entry (task: search may not parse all models). Lets the user
 *  type a model ID by hand and optionally a display name + context window. */
export function ManualModelInput({ onAdd, disabled }: Props) {
  const [form, setForm] = useState(EMPTY);

  const handleAdd = () => {
    const modelId = form.modelId.trim();
    if (!modelId) return;
    onAdd({
      modelId,
      displayName: form.displayName.trim() || modelId,
      contextWindow: form.contextWindow ? Number(form.contextWindow) : null,
      manual: true,
    });
    setForm(EMPTY);
  };

  return (
    <div className="rounded-md border border-dashed p-3">
      <Label className="text-xs">Add model manually</Label>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Model ID *</Label>
          <Input
            placeholder="e.g. gemini-2.5-flash"
            value={form.modelId}
            onChange={(e) => setForm({ ...form, modelId: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Display Name</Label>
          <Input
            placeholder="e.g. Gemini 2.5 Flash"
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
        </div>
        <div className="space-y-1 col-span-2">
          <Label className="text-[11px] text-muted-foreground">Context Window (tokens)</Label>
          <Input
            placeholder="e.g. 1000000 (leave empty for ∞)"
            value={form.contextWindow}
            onChange={(e) => setForm({ ...form, contextWindow: e.target.value })}
          />
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="mt-2 w-full"
        onClick={handleAdd}
        disabled={disabled || !form.modelId.trim()}
      >
        <Plus className="mr-1 h-3 w-3" /> Add Model
      </Button>
    </div>
  );
}
