"use client";

// ─── Injection Lab ─────────────────────────────────────
// Tasks 06–07. Craft and preview the Copilot askQuestion guidance
// block that the router would inject when a key hits a limit, and
// copy it for manual experimentation.

import { useState } from "react";
import {
  LIMIT_DISPLAY,
  LimitName,
  TemplateName,
  buildInjection,
  expectedOptions,
} from "@/engine/playground";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Copy, Check } from "lucide-react";
import { useState as useCopyState } from "react";

const LIMIT_OPTIONS = (Object.keys(LIMIT_DISPLAY) as LimitName[]).map((l) => ({
  value: l,
  label: LIMIT_DISPLAY[l],
}));

export function InjectionLab() {
  const [template, setTemplate] = useState<TemplateName>("compact_first");
  const [keyLabel, setKeyLabel] = useState("A-Deepseek");
  const [limitName, setLimitName] = useState<LimitName>("TPD");
  const [nextKeyLabel, setNextKeyLabel] = useState("B-Gemini");
  const [promptTokens, setPromptTokens] = useState(55000);
  const [lastPromptTokens, setLastPromptTokens] = useState(50000);
  const [copied, setCopied] = useCopyState(false);

  const payload = buildInjection(template, {
    keyLabel,
    limitName,
    nextKeyLabel,
    promptTokens,
    lastPromptTokens,
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Guidance inputs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-1">
            <Label className="text-[10px] uppercase text-muted-foreground">Template</Label>
            <Select value={template} onValueChange={(v) => setTemplate(v as TemplateName)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="compact_first">Compact-first (offer both choices)</SelectItem>
                <SelectItem value="direct_only">Direct-only (rotate, mention compact)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Hit key</Label>
              <Input value={keyLabel} onChange={(e) => setKeyLabel(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Limit hit</Label>
              <Select value={limitName} onValueChange={(v) => setLimitName(v as LimitName)}>
                <SelectTrigger>
                  <SelectValue />
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
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Next key</Label>
              <Input value={nextKeyLabel} onChange={(e) => setNextKeyLabel(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Prompt tokens</Label>
              <Input
                type="number"
                value={promptTokens}
                onChange={(e) => setPromptTokens(Number(e.target.value))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Last prompt tokens</Label>
              <Input
                type="number"
                value={lastPromptTokens}
                onChange={(e) => setLastPromptTokens(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="rounded-lg bg-muted/40 p-3 text-xs">
            <p className="font-medium text-foreground">Expected askQuestion options:</p>
            <ul className="mt-1 list-inside list-disc space-y-1 text-muted-foreground">
              {expectedOptions({ keyLabel, limitName, nextKeyLabel, promptTokens, lastPromptTokens }).map(
                (o, i) => (
                  <li key={i}>{o}</li>
                )
              )}
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm">Injected payload</CardTitle>
          <Button size="sm" variant="outline" onClick={copy}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </CardHeader>
        <CardContent>
          <Textarea readOnly value={payload} className="min-h-[16rem] font-mono text-xs" />
          <p className="mt-2 text-xs text-muted-foreground">
            This block would be appended to the next outgoing request so the model surfaces the
            decision via Copilot&apos;s <code>askQuestion</code> tool. Behavior depends on the
            agent&apos;s model and tool policy — experiment with phrasing here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
