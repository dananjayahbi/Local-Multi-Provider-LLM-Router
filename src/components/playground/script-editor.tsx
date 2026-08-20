"use client";

// ─── Script Editor ─────────────────────────────────────
// Edits the scripted workload: a list of requests, each with an
// input-token size and an optional mechanically-injected error so
// we can watch the selector react to every limit type.

import { LimitName, ScenarioStep } from "@/engine/playground";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";

interface Props {
  steps: ScenarioStep[];
  onChange: (steps: ScenarioStep[]) => void;
}

const LIMIT_OPTIONS: Array<{ value: LimitName | ""; label: string }> = [
  { value: "", label: "None" },
  { value: "RPM", label: "RPM" },
  { value: "TPM", label: "TPM" },
  { value: "RPD", label: "RPD" },
  { value: "TPD", label: "TPD" },
  { value: "CONTEXT", label: "CONTEXT" },
];

export function ScriptEditor({ steps, onChange }: Props) {
  const update = (i: number, patch: Partial<ScenarioStep>) => {
    onChange(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Scripted workload</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            onChange([
              ...steps,
              {
                id: steps.length + 1,
                request: { promptTokens: 10000, completionBudget: 1024 },
                injectError: null,
              },
            ])
          }
        >
          <Plus className="h-4 w-4" /> Add request
        </Button>
      </div>

      {steps.map((s, i) => (
        <Card key={s.id}>
          <CardContent className="flex flex-wrap items-end gap-2 p-3">
            <span className="mb-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              #{s.id}
            </span>
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Prompt tokens</Label>
              <Input
                type="number"
                className="h-7 w-32"
                value={s.request.promptTokens}
                onChange={(e) =>
                  update(i, { request: { ...s.request, promptTokens: Number(e.target.value) } })
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Completion budget</Label>
              <Input
                type="number"
                className="h-7 w-28"
                value={s.request.completionBudget}
                onChange={(e) =>
                  update(i, { request: { ...s.request, completionBudget: Number(e.target.value) } })
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Inject error</Label>
              <Select
                value={s.injectError ?? ""}
                onValueChange={(v) => update(i, { injectError: (v || null) as LimitName | null })}
              >
                <SelectTrigger className="h-7 w-32">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  {LIMIT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="mb-0.5"
              onClick={() => onChange(steps.filter((_, idx) => idx !== i))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
