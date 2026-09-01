"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Plus, Loader2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// ─── Types ──────────────────────────────────────────────

interface CatalogKey {
  id: string;
  label: string;
  providerName: string;
  poolNames: string[];
  requestsLastHour: number;
  hasLimits: boolean;
}

interface ChartKeySelectorProps {
  /** Currently selected key IDs (ordered). */
  selected: string[];
  onSelectionChange: (ids: string[]) => void;
}

// ─── Persistence ────────────────────────────────────────
// The user's chosen chart keys must survive a reload. We store the explicit
// selection in localStorage; if it's empty/absent we fall back to the top-2
// most-used keys so the chart never shows nothing.

const STORAGE_KEY = "usage.chart-key-ids";
const MAX_DEFAULT = 2;

function readStored(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function persist(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // ignore storage failures (private mode etc.)
  }
}

// ─── Component ──────────────────────────────────────────

export function ChartKeySelector({ selected, onSelectionChange }: ChartKeySelectorProps) {
  const [catalog, setCatalog] = useState<CatalogKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  // Fetch the catalog once. Requests-per-hour drives the default selection.
  useEffect(() => {
    let active = true;
    fetch("/api/admin/rate-limits/catalog")
      .then((r) => r.json())
      .then((data: CatalogKey[]) => {
        if (!active) return;
        setCatalog(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  // One-time hydration: restore stored selection, else pick the top-2 most-used.
  useEffect(() => {
    if (loading || hydrated) return;

    const stored = readStored();
    const validIds = new Set(catalog.map((k) => k.id));
    const storedValid = stored.filter((id) => validIds.has(id));

    if (storedValid.length > 0) {
      onSelectionChange(storedValid);
    } else {
      // Default: the 2 keys with the most traffic in the last hour. If fewer
      // than 2 keys have traffic, prefer keys that DO have limits configured.
      const byUsage = [...catalog].sort((a, b) => b.requestsLastHour - a.requestsLastHour);
      const active = byUsage.filter((k) => k.requestsLastHour > 0);
      const withLimits = byUsage.filter((k) => k.hasLimits);
      const pool = active.length > 0 ? active : withLimits.length > 0 ? withLimits : byUsage;
      onSelectionChange(pool.slice(0, MAX_DEFAULT).map((k) => k.id));
    }
    setHydrated(true);
  }, [loading, hydrated, catalog, onSelectionChange]);

  // Mirror every selection change into storage so reloads keep the config.
  useEffect(() => {
    if (!hydrated) return;
    persist(selected);
  }, [selected, hydrated]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const available = catalog.filter((k) => !selectedSet.has(k.id));
  const selectedKeys = useMemo(
    () => selected.map((id) => catalog.find((k) => k.id === id)).filter((k): k is CatalogKey => Boolean(k)),
    [selected, catalog]
  );

  const addKey = useCallback(
    (id: string) => {
      if (!id || selectedSet.has(id)) return;
      onSelectionChange([...selected, id]);
    },
    [selected, selectedSet, onSelectionChange]
  );

  const removeKey = useCallback(
    (id: string) => {
      onSelectionChange(selected.filter((s) => s !== id));
    },
    [selected, onSelectionChange]
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading keys…
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <KeyRound className="h-4 w-4 text-muted-foreground" />
      {selectedKeys.map((k) => (
        <Badge key={k.id} variant="secondary" className="gap-1.5 pr-1">
          {k.label}
          <span className="text-muted-foreground/70">· {k.providerName}</span>
          <button
            type="button"
            onClick={() => removeKey(k.id)}
            className="ml-0.5 rounded-full p-0.5 hover:bg-muted"
            aria-label={`Remove ${k.label}`}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}

      <Select onValueChange={(v) => v && addKey(v)} value="__add__">
        <SelectTrigger className="h-7 w-40 border-dashed text-xs">
          <SelectValue placeholder="+ Add key" />
        </SelectTrigger>
        <SelectContent>
          {available.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">All keys selected.</div>
          )}
          {available.map((k) => (
            <SelectItem key={k.id} value={k.id}>
              {k.label} · {k.providerName}
              {k.requestsLastHour > 0 && ` (${k.requestsLastHour}/hr)`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
