"use client";

import { useState } from "react";
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
import { ShieldAlert, Timer, Layers } from "lucide-react";

interface ManualPenaltyDialogProps {
  apiKey: { id: string; label: string; status: string };
  /** Called after a penalty is applied so the parent can re-fetch. */
  onChanged: () => void;
  /** Optional compact styling (defaults to a small outlined button). */
  size?: "sm" | "default";
}

const PENALTY_LEVELS = [1, 2, 3, 4, 5];

/**
 * Manually penalize an API key: pick an escalation level (cooldown derived
 * from the variable-penalty backoff settings) OR set a custom cooldown timer
 * (seconds). Fires PATCH /api/admin/keys/[id] with action "apply-penalty".
 */
export function ManualPenaltyDialog({ apiKey, onChanged, size = "sm" }: ManualPenaltyDialogProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"level" | "custom">("level");
  const [level, setLevel] = useState("1");
  const [customSeconds, setCustomSeconds] = useState("");
  const [busy, setBusy] = useState(false);

  const handleApply = async () => {
    setBusy(true);
    const payload: { action: string; level?: number; cooldownSeconds?: number } = {
      action: "apply-penalty",
    };
    if (mode === "level") {
      payload.level = parseInt(level, 10) || 1;
    } else {
      payload.cooldownSeconds = parseInt(customSeconds, 10) || 0;
    }

    const res = await fetch(`/api/admin/keys/${apiKey.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      onChanged();
    } else {
      const err = await res.json().catch(() => ({ error: "Failed to apply penalty" }));
      alert(err.error || "Failed to apply penalty");
    }
  };

  const baseCooldownFor = (lv: number) => {
    // Mirrors the VARIABLE backoff: base(600) × multiplier(3)^(level-1),
    // capped at maxCooldown(21600). Shown as guidance only.
    const base = 600;
    const mult = 3;
    const cap = 21600;
    return Math.min(base * Math.pow(mult, lv - 1), cap);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size={size} variant="outline" title="Manually apply a penalty">
          <ShieldAlert className="mr-1 h-3 w-3" /> Penalty
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" /> Manual Penalty — {apiKey.label}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <p className="text-sm text-muted-foreground">
            Apply a penalty immediately. The key will be excluded from routing until the
            cooldown expires.
          </p>

          {/* Mode toggle */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={mode === "level" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("level")}
            >
              <Layers className="mr-1 h-3 w-3" /> By Level
            </Button>
            <Button
              type="button"
              variant={mode === "custom" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("custom")}
            >
              <Timer className="mr-1 h-3 w-3" /> Custom Timer
            </Button>
          </div>

          {mode === "level" ? (
            <div className="space-y-2">
              <Label>Penalty Level</Label>
              <Select value={level} onValueChange={setLevel}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PENALTY_LEVELS.map((lv) => (
                    <SelectItem key={lv} value={String(lv)}>
                      Level {lv} — ≈{Math.round(baseCooldownFor(lv) / 60)} min
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Cooldown derived from the penalty engine backoff (base × multiplier^(level-1)).
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Cooldown (seconds)</Label>
              <Input
                type="number"
                min="1"
                value={customSeconds}
                onChange={(e) => setCustomSeconds(e.target.value)}
                placeholder="e.g., 3600 (1 hour)"
              />
              <p className="text-xs text-muted-foreground">
                A custom timer overrides the level-based duration entirely.
              </p>
            </div>
          )}

          <Button onClick={handleApply} className="w-full" disabled={busy}>
            {busy ? "Applying..." : "Apply Penalty"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
