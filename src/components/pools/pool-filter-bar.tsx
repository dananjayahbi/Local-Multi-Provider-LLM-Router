"use client";

import { useState } from "react";
import { Filter } from "lucide-react";
import { SearchInput } from "@/components/ui/search-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PoolItem } from "@/components/pools/pool-types";

export interface PoolFilters {
  query: string;
  strategy: string; // "" | "KEY_AWARE" | "ROUND_ROBIN" | "PRIORITY"
  type: string; // "" | "simple" | "unified"
}

export type PoolSortKey = "createdAt" | "name";

export interface PoolSort {
  key: PoolSortKey;
  dir: "asc" | "desc";
}

/** Case-insensitive search across pool name and virtual model name. */
export function matchesPoolFilters(p: PoolItem, filters: PoolFilters): boolean {
  const q = filters.query.trim().toLowerCase();
  if (q) {
    const haystack = `${p.name} ${p.virtualModelName} ${p.routingStrategy}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  if (filters.strategy && p.routingStrategy !== filters.strategy) return false;
  if (filters.type === "simple" && p._count.poolMembers !== 1) return false;
  if (filters.type === "unified" && p._count.poolMembers === 1) return false;
  return true;
}

/** Compare two pools by a sort key (defaults to newest-first by createdAt). */
export function comparePools(a: PoolItem, b: PoolItem, sort: PoolSort): number {
  let cmp = 0;
  if (sort.key === "name") {
    cmp = a.name.localeCompare(b.name);
  } else {
    const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    cmp = at - bt;
  }
  return sort.dir === "asc" ? cmp : -cmp;
}

interface Props {
  value: PoolFilters;
  onChange: (filters: PoolFilters) => void;
  sort: PoolSort;
  onSortChange: (sort: PoolSort) => void;
  totalCount: number;
}

/** Filter + search + sort bar for the Pools page. */
export function PoolFilterBar({ value, onChange, sort, onSortChange, totalCount }: Props) {
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
        placeholder="Search pools..."
        className="w-full max-w-xs"
      />
      <Select
        value={value.strategy}
        onValueChange={(v) => onChange({ ...value, strategy: v })}
      >
        <SelectTrigger className="w-44">
          <SelectValue placeholder="All strategies" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">All strategies</SelectItem>
          <SelectItem value="KEY_AWARE">Key Aware</SelectItem>
          <SelectItem value="ROUND_ROBIN">Round Robin</SelectItem>
          <SelectItem value="PRIORITY">Priority</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={value.type}
        onValueChange={(v) => onChange({ ...value, type: v })}
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder="All types" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">All types</SelectItem>
          <SelectItem value="simple">Simple</SelectItem>
          <SelectItem value="unified">Unified</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={sort.key}
        onValueChange={(v) => onSortChange({ ...sort, key: v as PoolSortKey })}
      >
        <SelectTrigger className="w-48">
          <SelectValue placeholder="Sort" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="createdAt">Created date</SelectItem>
          <SelectItem value="name">Name</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={sort.dir}
        onValueChange={(v) => onSortChange({ ...sort, dir: v as PoolSort["dir"] })}
      >
        <SelectTrigger className="w-28">
          <SelectValue placeholder="Order" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="desc">Newest</SelectItem>
          <SelectItem value="asc">Oldest</SelectItem>
        </SelectContent>
      </Select>
      <span className="text-xs text-muted-foreground">
        {totalCount} result{totalCount === 1 ? "" : "s"}
      </span>
    </div>
  );
}
