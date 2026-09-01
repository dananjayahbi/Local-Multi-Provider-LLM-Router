"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ListChecks, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────

interface CatalogKey {
  id: string;
  label: string;
  providerName: string;
}

interface MeshKeyPickerProps {
  /** All selectable keys (from the catalog). */
  options: CatalogKey[];
  /** Currently included key ids. */
  selected: string[];
  onSelectionChange: (ids: string[]) => void;
}

/**
 * Dropdown with checkboxes to pick which keys appear in the mesh animation.
 * Unlike the chart selector (top-2), this lets you select as many as you want.
 */
export function MeshKeyPicker({ options, selected, onSelectionChange }: MeshKeyPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedLabels = useMemo(
    () => options.filter((o) => selectedSet.has(o.id)).map((o) => o.label),
    [options, selectedSet]
  );

  const toggle = (id: string) => {
    const next = selectedSet.has(id) ? selected.filter((s) => s !== id) : [...selected, id];
    onSelectionChange(next);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 items-center gap-2 rounded-md border px-3 text-sm transition-colors hover:bg-muted"
      >
        <ListChecks className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="max-w-40 truncate">
          {selectedLabels.length === 0
            ? "Select keys"
            : selectedLabels.length === 1
            ? selectedLabels[0]
            : `${selectedLabels.length} keys`}
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-64 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">Keys in animation</span>
            <div className="flex gap-2">
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => onSelectionChange(options.map((o) => o.id))}
              >
                All
              </button>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => onSelectionChange([])}
              >
                None
              </button>
            </div>
          </div>
          <div className="max-h-60 overflow-auto p-1">
            {options.map((o) => (
              <label
                key={o.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-foreground/20 accent-(--color-primary)"
                  checked={selectedSet.has(o.id)}
                  onChange={() => toggle(o.id)}
                />
                <span className="flex-1 truncate">{o.label}</span>
                <span className="truncate text-[11px] text-muted-foreground">{o.providerName}</span>
                {selectedSet.has(o.id) && <Check className="h-3.5 w-3.5 text-primary" />}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
