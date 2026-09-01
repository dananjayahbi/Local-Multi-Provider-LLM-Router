"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function CreateDraftDialog({ open, onOpenChange, onCreated }: Props) {
  const [form, setForm] = useState({
    name: "",
    baseUrl: "",
    apiFormat: "CHAT_COMPLETIONS",
    sourceUrl: "",
    models: "",
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!form.name || !form.baseUrl) return;
    setSaving(true);
    try {
      const discoveredModels = form.models
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean)
        .map((m) => ({ modelId: m, displayName: m }));

      await fetch("/api/admin/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          baseUrl: form.baseUrl,
          apiFormat: form.apiFormat,
          sourceUrl: form.sourceUrl || null,
          discoveredModels,
        }),
      });
      setForm({ name: "", baseUrl: "", apiFormat: "CHAT_COMPLETIONS", sourceUrl: "", models: "" });
      onCreated();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Draft Provider</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Provider Name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. MyFreeProvider"
            />
          </div>
          <div className="space-y-2">
            <Label>Base URL</Label>
            <Input
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder="https://api.example.com/v1"
            />
          </div>
          <div className="space-y-2">
            <Label>API Format</Label>
            <Select
              value={form.apiFormat}
              onValueChange={(v) => setForm({ ...form, apiFormat: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CHAT_COMPLETIONS">Chat Completions</SelectItem>
                <SelectItem value="MESSAGES">Messages (Anthropic)</SelectItem>
                <SelectItem value="RESPONSES">Responses (OpenAI)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Source URL (optional)</Label>
            <Input
              value={form.sourceUrl}
              onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
              placeholder="https://github.com/..."
            />
          </div>
          <div className="space-y-2">
            <Label>Models (comma-separated)</Label>
            <Input
              value={form.models}
              onChange={(e) => setForm({ ...form, models: e.target.value })}
              placeholder="model-1, model-2"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving || !form.name || !form.baseUrl}>
            {saving ? "Creating..." : "Create Draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
