"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FlaskConical, Loader2 } from "lucide-react";
import type { CalibrationProviderOption } from "./calibration-types";

/**
 * Calibration session launcher. Calibration is scoped to ONE
 * provider at a time: pick a provider, then one of its keys and
 * one of its models, and start a research-only session (the Hermes
 * agent finds the provider's free-quota rate limits — no stressing).
 */
export function CalibrationSessionForm({
  providers,
  submitting,
  onSubmit,
}: {
  providers: CalibrationProviderOption[];
  submitting: boolean;
  onSubmit: (input: {
    providerId: string;
    apiKeyId: string;
    providerModelId: string;
  }) => void;
}) {
  const [providerId, setProviderId] = useState("");
  const [apiKeyId, setApiKeyId] = useState("");
  const [providerModelId, setProviderModelId] = useState("");

  const provider = useMemo(
    () => providers.find((p) => p.id === providerId),
    [providers, providerId]
  );

  const handleProviderChange = (id: string) => {
    setProviderId(id);
    setApiKeyId("");
    setProviderModelId("");
  };

  const canSubmit = Boolean(providerId && apiKeyId && providerModelId);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="h-4 w-4 text-primary" />
          Calibration Session
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Runs <span className="font-medium">one provider at a time</span>. The Hermes agent
          researches the provider&apos;s published free-quota rate limits from the web — it never
          stresses the key or calls the model.
        </p>

        <div className="space-y-2">
          <Label>Provider</Label>
          <Select value={providerId || undefined} onValueChange={handleProviderChange}>
            <SelectTrigger>
              <SelectValue placeholder="Select a provider" />
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

        <div className="space-y-2">
          <Label>API Key</Label>
          <Select
            value={apiKeyId || undefined}
            onValueChange={setApiKeyId}
            disabled={!provider}
          >
            <SelectTrigger>
              <SelectValue placeholder={provider ? "Select a key" : "Select a provider first"} />
            </SelectTrigger>
            <SelectContent>
              {provider?.keys.map((k) => (
                <SelectItem key={k.id} value={k.id}>
                  {k.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Model</Label>
          <Select
            value={providerModelId || undefined}
            onValueChange={setProviderModelId}
            disabled={!provider}
          >
            <SelectTrigger>
              <SelectValue placeholder={provider ? "Select a model" : "Select a provider first"} />
            </SelectTrigger>
            <SelectContent>
              {provider?.models.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          className="w-full"
          onClick={() => onSubmit({ providerId, apiKeyId, providerModelId })}
          disabled={!canSubmit || submitting}
        >
          {submitting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <FlaskConical className="mr-2 h-4 w-4" />
          )}
          {submitting ? "Queuing Session..." : "Start Calibration Session"}
        </Button>
      </CardContent>
    </Card>
  );
}
