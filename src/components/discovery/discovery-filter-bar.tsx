"use client";

import { useState } from "react";
import { Filter } from "lucide-react";
import { SearchInput } from "@/components/ui/search-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Draft } from "./discovery-types";

export interface DiscoveryFilters {
  query: string;
  format: string;
}

interface Props {
  value: DiscoveryFilters;
  onChange: (filters: DiscoveryFilters) => void;
  totalCount: number;
}

const FORMATS = ["CHAT_COMPLETIONS", "MESSAGES", "RESPONSES"];

/** Case-insensitive search across name, base URL, and discovered model ids. */
export function matchesDiscoveryFilters(draft: Draft, filters: DiscoveryFilters): boolean {
  const q = filters.query.trim().toLowerCase();
  if (q) {
    const modelIds = (draft.discoveredModels || "")
      .toLowerCase();
    const haystack = `${draft.name} ${draft.baseUrl} ${modelIds}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  if (filters.format && draft.apiFormat !== filters.format) return false;
  return true;
}

/** Filter bar for the Discovery page: free-text search + API format filter. */
export function DiscoveryFilterBar({ value, onChange, totalCount }: Props) {
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
        placeholder="Search by name, base URL or model..."
        className="w-full max-w-xs"
      />
      <Select
        value={value.format}
        onValueChange={(v) => onChange({ ...value, format: v })}
      >
        <SelectTrigger className="w-48">
          <SelectValue placeholder="All formats" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">All formats</SelectItem>
          {FORMATS.map((f) => (
            <SelectItem key={f} value={f}>
              {f}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-xs text-muted-foreground">
        {totalCount} result{totalCount === 1 ? "" : "s"}
      </span>
    </div>
  );
}
