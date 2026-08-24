"use client";

import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Filter } from "lucide-react";

interface FilterOption {
  id: string;
  name: string;
}

interface ProviderOption extends FilterOption {
  models: { id: string; name: string }[];
}

interface PenaltyFilterBarProps {
  providers: ProviderOption[];
  onFilterChange: (f: { providerId?: string; modelId?: string }) => void;
}

/**
 * Provider + model filters for the penalty inspector. Selecting a provider
 * narrows the model list to that provider's models.
 */
export function PenaltyFilterBar({ providers, onFilterChange }: PenaltyFilterBarProps) {
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");

  const models = providerId
    ? (providers.find((p) => p.id === providerId)?.models ?? [])
    : providers.flatMap((p) => p.models);

  const apply = (p: string, m: string) => {
    onFilterChange({ providerId: p || undefined, modelId: m || undefined });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Filter className="h-4 w-4 text-muted-foreground" />
      <Select
        value={providerId}
        onValueChange={(v) => {
          setProviderId(v);
          setModelId("");
          apply(v, "");
        }}
      >
        <SelectTrigger className="w-44">
          <SelectValue placeholder="All providers" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">All providers</SelectItem>
          {providers.map((p) => (
            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={modelId}
        onValueChange={(v) => {
          setModelId(v);
          apply(providerId, v);
        }}
      >
        <SelectTrigger className="w-44">
          <SelectValue placeholder="All models" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">All models</SelectItem>
          {models.map((m) => (
            <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
