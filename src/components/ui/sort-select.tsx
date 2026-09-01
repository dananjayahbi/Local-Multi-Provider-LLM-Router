"use client";

import { ArrowUpDown } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface SortOption {
  value: string;
  label: string;
}

interface SortSelectProps {
  /** Ordered list of sortable keys (e.g. "createdAt", "name"). */
  options: SortOption[];
  value: string;
  dir: "asc" | "desc";
  onValueChange: (value: string) => void;
  onDirChange: (dir: "asc" | "desc") => void;
}

/** Reusable sort control: a key selector + a direction selector. */
export function SortSelect({ options, value, dir, onValueChange, onDirChange }: SortSelectProps) {
  return (
    <div className="flex items-center gap-2">
      <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="w-44">
          <SelectValue placeholder="Sort by" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={dir} onValueChange={(v) => onDirChange(v as "asc" | "desc")}>
        <SelectTrigger className="w-28">
          <SelectValue placeholder="Order" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="desc">Newest</SelectItem>
          <SelectItem value="asc">Oldest</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
