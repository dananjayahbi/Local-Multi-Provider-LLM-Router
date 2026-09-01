"use client";

import { useState } from "react";
import { Filter } from "lucide-react";
import { SearchInput } from "@/components/ui/search-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ModelRow } from "./model-table";

export interface ModelFilters {
  query: string;
  providerId: string;
  capability: string; // "" | "vision" | "function-calling"
  status: string; // "" | "enabled" | "disabled"
}

interface Props {
  value: ModelFilters;
  onChange: (filters: ModelFilters) => void;
  providers: { id: string; name: string }[];
  totalCount: number;
}

/** Case-insensitive search across model id, display name, and provider name. */
export function matchesModelFilters(m: ModelRow, filters: ModelFilters): boolean {
  const q = filters.query.trim().toLowerCase();
  if (q) {
    const haystack = `${m.modelId} ${m.displayName} ${m.provider.name}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  if (filters.providerId && m.provider.id !== filters.providerId) return false;
  if (filters.capability === "vision" && !m.supportsVision) return false;
  if (filters.capability === "function-calling" && !m.supportsFunctionCalling) return false;
  if (filters.status === "enabled" && !m.enabled) return false;
  if (filters.status === "disabled" && m.enabled) return false;
  return true;
}

/** Filter bar for the Models page: search + provider + capability + status. */
export function ModelFilterBar({ value, onChange, providers, totalCount }: Props) {
  const [query, setQuery] = useState(value.query);

  const updateQuery = (q: string) => {
    setQuery(q);
    onChange({ ...value, query: q });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Filter className="h-4 w-4 text-muted-foreground" />
      <SearchInput
        value={query}
        onChange={updateQuery}
        placeholder="Search model or provider..."
        className="w-full max-w-xs"
      />
      <Select
        value={value.providerId}
        onValueChange={(v) => onChange({ ...value, providerId: v })}
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
        value={value.capability}
        onValueChange={(v) => onChange({ ...value, capability: v })}
      >
        <SelectTrigger className="w-44">
          <SelectValue placeholder="All capabilities" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">All capabilities</SelectItem>
          <SelectItem value="vision">Vision</SelectItem>
          <SelectItem value="function-calling">Function Calling</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={value.status}
        onValueChange={(v) => onChange({ ...value, status: v })}
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder="All statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">All statuses</SelectItem>
          <SelectItem value="enabled">Enabled</SelectItem>
          <SelectItem value="disabled">Disabled</SelectItem>
        </SelectContent>
      </Select>
      <span className="text-xs text-muted-foreground">
        {totalCount} result{totalCount === 1 ? "" : "s"}
      </span>
    </div>
  );
}
