"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarDays } from "lucide-react";

export type DateRangePreset =
  | "past_hour"
  | "past_3_hours"
  | "today"
  | "yesterday"
  | "this_week"
  | "this_month"
  | "prev_month"
  | "all_time"
  | "custom";

interface DateRange {
  from: Date;
  to: Date;
}

function getDateRange(preset: DateRangePreset): DateRange {
  const now = new Date();
  const to = new Date(now);

  switch (preset) {
    case "past_hour":
      return { from: new Date(now.getTime() - 3600000), to };
    case "past_3_hours":
      return { from: new Date(now.getTime() - 3 * 3600000), to };
    case "today": {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return { from: start, to };
    }
    case "yesterday": {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return { from: start, to: end };
    }
    case "this_week": {
      const day = now.getDay();
      const diff = day === 0 ? 6 : day - 1;
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
      return { from: monday, to };
    }
    case "this_month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: start, to };
    }
    case "prev_month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: start, to: end };
    }
    case "all_time":
    default:
      return { from: new Date(0), to };
  }
}

interface DateRangeSelectorProps {
  preset: DateRangePreset;
  onPresetChange: (preset: DateRangePreset, range: DateRange) => void;
  customFrom?: string;
  customTo?: string;
  onCustomChange: (from: string, to: string) => void;
}

const PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: "past_hour", label: "Past Hour" },
  { value: "past_3_hours", label: "Past 3 Hours" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this_week", label: "This Week" },
  { value: "this_month", label: "This Month" },
  { value: "prev_month", label: "Previous Month" },
  { value: "all_time", label: "All Time" },
  { value: "custom", label: "Custom Range" },
];

export function DateRangeSelector({
  preset,
  onPresetChange,
  customFrom,
  customTo,
  onCustomChange,
}: DateRangeSelectorProps) {
  return (
    <div className="flex items-center gap-3">
      <CalendarDays className="h-4 w-4 text-muted-foreground" />
      <Select
        value={preset}
        onValueChange={(v) => {
          const p = v as DateRangePreset;
          onPresetChange(p, getDateRange(p));
        }}
      >
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRESETS.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {preset === "custom" && (
        <div className="flex items-center gap-2 text-sm">
          <input
            type="date"
            value={customFrom || ""}
            onChange={(e) => onCustomChange(e.target.value, customTo || "")}
            className="rounded-md border px-2 py-1 text-xs bg-background"
          />
          <span className="text-muted-foreground">to</span>
          <input
            type="date"
            value={customTo || ""}
            onChange={(e) => onCustomChange(customFrom || "", e.target.value)}
            className="rounded-md border px-2 py-1 text-xs bg-background"
          />
        </div>
      )}
    </div>
  );
}
