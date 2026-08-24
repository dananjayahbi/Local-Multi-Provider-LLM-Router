"use client";

import { Minus, Plus, Maximize } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────

interface MeshZoomControlProps {
  autoFit: boolean;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  onAutoFitToggle: (v: boolean) => void;
  onZoomChange: (z: number) => void;
  /** "fit" letterboxes (meet) to show the whole mesh; "fill" stretches. */
  fitMode?: "meet" | "fill";
}

/**
 * Zoom / autofit controls floating over the mesh. Autofit keeps the whole mesh
 * visible (scales it down/up to the viewport); when off, the +/- buttons let
 * you scale manually around the center.
 */
export function MeshZoomControl({
  autoFit,
  zoom,
  minZoom,
  maxZoom,
  onAutoFitToggle,
  onZoomChange,
}: MeshZoomControlProps) {
  return (
    <div className="flex items-center gap-1 rounded-md border bg-background/90 p-1 shadow-sm backdrop-blur">
      <button
        type="button"
        onClick={() => onZoomChange(Math.max(minZoom, zoom - 0.25))}
        disabled={!autoFit && zoom <= minZoom}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40"
        aria-label="Zoom out"
        title="Zoom out"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="w-10 text-center text-xs tabular-nums text-muted-foreground">
        {autoFit ? "fit" : `${Math.round(zoom * 100)}%`}
      </span>
      <button
        type="button"
        onClick={() => onZoomChange(Math.min(maxZoom, zoom + 0.25))}
        disabled={!autoFit && zoom >= maxZoom}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40"
        aria-label="Zoom in"
        title="Zoom in"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      <div className="mx-1 h-5 w-px bg-border" />
      <button
        type="button"
        onClick={() => onAutoFitToggle(!autoFit)}
        className={cn(
          "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs transition-colors",
          autoFit ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
        )}
        title={autoFit ? "Auto-fit: ON (click to zoom manually)" : "Auto-fit to screen"}
      >
        <Maximize className="h-3.5 w-3.5" />
        Auto-fit
      </button>
    </div>
  );
}
