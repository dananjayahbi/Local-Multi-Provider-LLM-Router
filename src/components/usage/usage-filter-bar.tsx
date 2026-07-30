"use client";

import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Filter } from "lucide-react";

interface FilterOption {
  id: string;
  name: string;
}

interface UsageFilterBarProps {
  onFiltersChange: (filters: {
    providerId?: string;
    poolId?: string;
    apiKeyId?: string;
  }) => void;
}

export function UsageFilterBar({ onFiltersChange }: UsageFilterBarProps) {
  const [providers, setProviders] = useState<FilterOption[]>([]);
  const [pools, setPools] = useState<FilterOption[]>([]);
  const [apiKeys, setApiKeys] = useState<FilterOption[]>([]);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedPool, setSelectedPool] = useState("");
  const [selectedKey, setSelectedKey] = useState("");

  useEffect(() => {
    fetch("/api/admin/providers")
      .then((r) => r.json())
      .then((data: FilterOption[]) => setProviders(data));
    fetch("/api/admin/pools")
      .then((r) => r.json())
      .then((data: FilterOption[]) => setPools(data));
  }, []);

  useEffect(() => {
    if (selectedProvider) {
      fetch(`/api/admin/providers/${selectedProvider}/keys`)
        .then((r) => r.json())
        .then((data: Array<{ id: string; label: string }>) =>
          setApiKeys(data.map((k) => ({ id: k.id, name: k.label })))
        );
    } else {
      setApiKeys([]);
    }
  }, [selectedProvider]);

  const updateFilters = (provider?: string, pool?: string, key?: string) => {
    onFiltersChange({
      providerId: provider || undefined,
      poolId: pool || undefined,
      apiKeyId: key || undefined,
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Filter className="h-4 w-4 text-muted-foreground" />
      <Select
        value={selectedProvider}
        onValueChange={(v) => {
          setSelectedProvider(v);
          setSelectedKey("");
          updateFilters(v, selectedPool, "");
        }}
      >
        <SelectTrigger className="w-44">
          <SelectValue placeholder="All Providers" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">All Providers</SelectItem>
          {providers.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={selectedPool}
        onValueChange={(v) => {
          setSelectedPool(v);
          updateFilters(selectedProvider, v, selectedKey);
        }}
      >
        <SelectTrigger className="w-44">
          <SelectValue placeholder="All Pools" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">All Pools</SelectItem>
          {pools.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={selectedKey}
        onValueChange={(v) => {
          setSelectedKey(v);
          updateFilters(selectedProvider, selectedPool, v);
        }}
      >
        <SelectTrigger className="w-48">
          <SelectValue placeholder="All API Keys" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">All API Keys</SelectItem>
          {apiKeys.map((k) => (
            <SelectItem key={k.id} value={k.id}>
              {k.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
