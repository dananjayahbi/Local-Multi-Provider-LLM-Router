"use client";

// ─── Mock Key Editor ───────────────────────────────────
// Edits the simulated provider-key pool used by the algorithm
// simulator. Each key carries its own rpm/tpm/rpd/tpd/tps/ttft/
// context/cache settings (design doc §2.2).

import { SimKey } from "@/engine/playground";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Trash2 } from "lucide-react";

interface Props {
  keys: SimKey[];
  onChange: (keys: SimKey[]) => void;
}

function Field({
  label,
  value,
  onChange,
  placeholder = "∞",
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <Input
        type="number"
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === "" ? null : Number(raw));
        }}
      />
    </div>
  );
}

export function MockKeyEditor({ keys, onChange }: Props) {
  const update = (id: string, patch: Partial<SimKey>) => {
    onChange(keys.map((k) => (k.id === id ? { ...k, ...patch } : k)));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Mock provider pool</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            onChange([
              ...keys,
              {
                id: `k${Date.now()}`,
                label: `Key ${keys.length + 1}`,
                provider: "mock",
                rpmLimit: 10,
                tpmLimit: 60000,
                rpdLimit: null,
                tpdLimit: null,
                tps: 150,
                timeToFirstTokenMs: 200,
                contextWindow: 32000,
                cacheCapable: true,
                cacheDiscountFactor: 0.1,
                status: "ACTIVE",
                penaltyLevel: 0,
                penaltyExpiresAt: null,
              },
            ])
          }
        >
          <Plus className="h-4 w-4" /> Add key
        </Button>
      </div>

      {keys.map((k, i) => (
        <Card key={k.id}>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-1 items-center gap-2">
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {i + 1}
                </span>
                <Input
                  value={k.label}
                  className="h-7 flex-1"
                  onChange={(e) => update(k.id, { label: e.target.value })}
                />
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => onChange(keys.filter((x) => x.id !== k.id))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              <Field label="RPM" value={k.rpmLimit} onChange={(v) => update(k.id, { rpmLimit: v })} />
              <Field label="TPM" value={k.tpmLimit} onChange={(v) => update(k.id, { tpmLimit: v })} />
              <Field label="RPD" value={k.rpdLimit} onChange={(v) => update(k.id, { rpdLimit: v })} />
              <Field label="TPD" value={k.tpdLimit} onChange={(v) => update(k.id, { tpdLimit: v })} />
              <Field label="TPS" value={k.tps} onChange={(v) => update(k.id, { tps: v })} />
              <Field
                label="TTFT ms"
                value={k.timeToFirstTokenMs}
                onChange={(v) => update(k.id, { timeToFirstTokenMs: v ?? 200 })}
              />
              <Field
                label="Context"
                value={k.contextWindow}
                onChange={(v) => update(k.id, { contextWindow: v ?? 0 })}
              />
              <Field
                label="Cache disc."
                value={k.cacheDiscountFactor}
                onChange={(v) => update(k.id, { cacheDiscountFactor: v ?? 0.1 })}
              />
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={k.cacheCapable}
                    onChange={(e) => update(k.id, { cacheCapable: e.target.checked })}
                  />
                  Cache
                </label>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
