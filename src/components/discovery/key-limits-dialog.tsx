"use client";

import { useEffect, useState } from "react";
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

export interface RateLimitKey {
  id: string;
  label: string;
  rpmLimit: number | null;
  tpmLimit: number | null;
  rpdLimit: number | null;
  tpdLimit: number | null;
  tps: number | null;
  timeToFirstTokenMs: number | null;
  contextWindow: number | null;
  cacheCapable?: boolean;
}

interface Props {
  keyData: RateLimitKey | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

const EMPTY = { rpmLimit: "", tpmLimit: "", rpdLimit: "", tpdLimit: "", tps: "", timeToFirstTokenMs: "", contextWindow: "" };

const fmt = (v: number | null) => (v != null ? String(v) : "");

/** Edit rate/token limits for a single API key (task): RPM, TPM, RPD, TPD,
 *  tokens/sec, TTFT, and context window. Saves via PUT /api/admin/keys/[id]. */
export function KeyLimitsDialog({ keyData, onOpenChange, onSaved }: Props) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (keyData) {
      setForm({
        rpmLimit: fmt(keyData.rpmLimit),
        tpmLimit: fmt(keyData.tpmLimit),
        rpdLimit: fmt(keyData.rpdLimit),
        tpdLimit: fmt(keyData.tpdLimit),
        tps: fmt(keyData.tps),
        timeToFirstTokenMs: fmt(keyData.timeToFirstTokenMs),
        contextWindow: fmt(keyData.contextWindow),
      });
    }
  }, [keyData]);

  const handleSave = async () => {
    if (!keyData) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/keys/${keyData.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rpmLimit: form.rpmLimit ? Number(form.rpmLimit) : null,
          tpmLimit: form.tpmLimit ? Number(form.tpmLimit) : null,
          rpdLimit: form.rpdLimit ? Number(form.rpdLimit) : null,
          tpdLimit: form.tpdLimit ? Number(form.tpdLimit) : null,
          tps: form.tps ? Number(form.tps) : null,
          timeToFirstTokenMs: form.timeToFirstTokenMs ? Number(form.timeToFirstTokenMs) : null,
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
    <Dialog open={!!keyData} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Key Limits — {keyData?.label}</DialogTitle>
          <DialogDescription>
            Rate/token limits for this key. Leave blank for unlimited. These
            limits differ per provider.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ["rpmLimit", "RPM (requests/min)"],
              ["tpmLimit", "TPM (tokens/min)"],
              ["rpdLimit", "RPD (requests/day)"],
              ["tpdLimit", "TPD (tokens/day)"],
              ["tps", "Tokens/sec (speed)"],
              ["timeToFirstTokenMs", "TTFT (ms latency)"],
              ["contextWindow", "Context window (tokens)"],
            ] as const
          ).map(([field, label]) => (
            <div key={field} className="space-y-1">
              <Label className="text-xs">{label}</Label>
              <Input
                placeholder="unlimited"
                value={form[field]}
                onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
              />
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Save Limits
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
