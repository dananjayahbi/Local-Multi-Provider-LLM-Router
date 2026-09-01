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
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Loader2, Rocket, Trash2, Eye } from "lucide-react";
import { Draft, CuratedModel, parseDiscoveredModels } from "./discovery-types";
import { ManualModelInput } from "./manual-model-input";

interface Props {
  draft: Draft;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfigured: () => void;
}

/** Configure dialog: pick discovered models AND add your own by model ID
 *  (search may not parse every model), correct the base URL, then review that
 *  everything is filled before hitting Configure. */
export function ConfigureProviderDialog({ draft, open, onOpenChange, onConfigured }: Props) {
  const discovered = parseDiscoveredModels(draft);
  const [baseUrl, setBaseUrl] = useState(draft.baseUrl);
  const [curated, setCurated] = useState<CuratedModel[]>(() =>
    discovered.map((m) => ({ ...m, manual: false }))
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(discovered.map((m) => m.modelId))
  );
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectedModels = curated.filter((m) => selectedIds.has(m.modelId));

  const toggle = (modelId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  };

  const addManual = (m: CuratedModel) => {
    // Dedupe by modelId.
    setCurated((prev) => (prev.some((c) => c.modelId === m.modelId) ? prev : [...prev, m]));
    setSelectedIds((prev) => new Set(prev).add(m.modelId));
  };

  const removeManual = (modelId: string) => {
    setCurated((prev) => prev.filter((c) => c.modelId !== modelId || !c.manual));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(modelId);
      return next;
    });
  };

  const baseUrlValid = /^https?:\/\/\S+$/.test(baseUrl.trim());
  const allValid = baseUrlValid && selectedModels.length > 0 && selectedModels.every((m) => m.modelId.trim());

  const handleConfigure = async () => {
    if (!allValid) return;
    setSaving(true);
    try {
      const models = selectedModels.map((m) => ({
        modelId: m.modelId,
        displayName: m.displayName,
        supportsVision: m.supportsVision,
        supportsFunctionCalling: m.supportsFunctionCalling,
        contextWindow: m.contextWindow ?? null,
        enabled: true,
      }));
      const res = await fetch(`/api/admin/drafts/${draft.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "configure", models, baseUrl: baseUrl.trim() }),
      });
      if (res.ok) {
        onOpenChange(false);
        setReviewing(false);
        onConfigured();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Configure — {draft.name}</DialogTitle>
          <DialogDescription>
            {reviewing
              ? "Review the configuration below. Make sure everything is filled before confirming."
              : "Select discovered models, add any missing ones by ID, and confirm the base URL."}
          </DialogDescription>
        </DialogHeader>

        {/* ── Review step ── */}
        {reviewing ? (
          <div className="space-y-3">
            <div className="rounded-md border p-3">
              <Label className="text-xs text-muted-foreground">Base URL</Label>
              <code className="mt-1 block break-all text-sm font-mono">{baseUrl.trim()}</code>
              {!baseUrlValid && (
                <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
                  <AlertTriangle className="h-3 w-3" /> Invalid URL — must start with http(s)://
                </p>
              )}
            </div>
            <div className="rounded-md border p-3">
              <Label className="text-xs text-muted-foreground">
                Models to configure ({selectedModels.length})
              </Label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selectedModels.map((m) => (
                  <Badge key={m.modelId} variant="secondary">
                    {m.modelId}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <AlertTriangle className="h-3 w-3" />
              {allValid
                ? "All fields are filled. Ready to configure."
                : "Some required fields are missing. Go back to fix them."}
            </div>
          </div>
        ) : (
          <>
            {/* ── Base URL ── */}
            <div className="space-y-1">
              <Label className="text-xs">Base URL *</Label>
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1"
                className={!baseUrlValid ? "border-destructive" : ""}
              />
              {!baseUrlValid && (
                <p className="text-xs text-destructive">
                  A valid http(s):// base URL is required.
                </p>
              )}
            </div>

            {/* ── Discovered models ── */}
            {curated.length > 0 ? (
              <div className="space-y-1.5">
                <Label className="text-xs">Select models</Label>
                {curated.map((m) => (
                  <label
                    key={m.modelId}
                    className="flex cursor-pointer items-center justify-between gap-2 rounded-md border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <code className="text-sm font-medium">{m.modelId}</code>
                      <Badge variant="secondary" className="ml-2">
                        {m.displayName || m.modelId}
                      </Badge>
                      {m.manual && (
                        <Badge variant="outline" className="ml-1">
                          manual
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {m.manual && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            removeManual(m.modelId);
                          }}
                          className="text-destructive"
                          aria-label={`Remove ${m.modelId}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                      <input
                        type="checkbox"
                        checked={selectedIds.has(m.modelId)}
                        onChange={() => toggle(m.modelId)}
                      />
                    </div>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No discovered models. Add them manually below.
              </p>
            )}

            {/* ── Manual add ── */}
            <ManualModelInput onAdd={addManual} disabled={saving} />

            {selectedModels.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Select or add at least one model.
              </p>
            )}
          </>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          {reviewing ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setReviewing(false)}>
                Back
              </Button>
              <Button size="sm" onClick={handleConfigure} disabled={saving || !allValid}>
                {saving ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Rocket className="mr-1 h-3 w-3" />
                )}
                Confirm & Configure
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => setReviewing(true)} disabled={!allValid}>
                <Eye className="mr-1 h-3 w-3" /> Review
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
