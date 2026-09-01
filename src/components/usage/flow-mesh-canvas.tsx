"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FlowMapSvg } from "./flow-map-svg";
import { useFlowMeshData } from "./use-flow-mesh-data";
import { useCatalog } from "./use-catalog";
import { MeshKeyPicker } from "./mesh-key-picker";
import { MeshZoomControl } from "./mesh-zoom-control";
import { MESH_WIDTH } from "./flow-map-layout";

// ─── Persistence ────────────────────────────────────────
// Which keys appear in the mesh is persisted so reloads keep the selection.
const MESH_STORAGE_KEY = "usage.mesh-key-ids";

interface FlowMeshCanvasProps {
  /** Config key for the storage namespace (so embedded vs fullscreen don't clash). */
  storageKey?: string;
  /** Hide the picker (fullscreen already has controls). */
  hidePicker?: boolean;
  /** Optional width/height sizing class for the svg container. */
  className?: string;
  /** Height class for the canvas container (defaults to 70vh). */
  heightClass?: string;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;

/**
 * Self-contained canvas: fetches live mesh data, lets the user pick which keys
 * to include (checkboxes, persisted), and renders the radial mesh. Used both
 * inline on /usage and by the fullscreen page.
 */
export function FlowMeshCanvas({ storageKey = MESH_STORAGE_KEY, hidePicker = false, className, heightClass }: FlowMeshCanvasProps) {
  const { catalog } = useCatalog();
  const [selectedKeys, setSelectedKeys] = useState<string[] | null>(null);
  const [hydrated, setHydrated] = useState(false);
  // Auto-fit = the mesh scales to fill the screen (meet). When off, manual zoom.
  const [autoFit, setAutoFit] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Restore selection, default to all keys with limits (or traffic).
  useEffect(() => {
    if (hydrated || catalog.length === 0) return;
    let selected: string[] = [];
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(storageKey);
        const parsed = raw ? JSON.parse(raw) : null;
        selected = Array.isArray(parsed) ? parsed.filter((x: string) => catalog.some((c) => c.id === x)) : [];
      } catch {
        selected = [];
      }
    }
    if (selected.length === 0) {
      // Default: keys that have rate limits, else top-6 by traffic, else all.
      const withLimits = catalog.filter((c) => c.hasLimits);
      const byTraffic = [...catalog].sort((a, b) => b.requestsLastHour - a.requestsLastHour).slice(0, 6);
      const pool = withLimits.length > 0 ? withLimits : byTraffic;
      selected = pool.map((c) => c.id);
    }
    setSelectedKeys(selected);
    setHydrated(true);
  }, [hydrated, catalog, storageKey]);

  // Mirror selection to storage.
  useEffect(() => {
    if (!hydrated || selectedKeys === null) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(selectedKeys));
    } catch {
      // ignore
    }
  }, [selectedKeys, hydrated, storageKey]);

  const poolId = undefined; // mesh shows all pools by default (picker handles keys)
  const { meshKeys, aggregated, active, events } = useFlowMeshData({
    filterKeys: selectedKeys ?? undefined,
    poolId,
  });

  const pickerOptions = useMemo(
    () => catalog.map((c) => ({ id: c.id, label: c.label, providerName: c.providerName })),
    [catalog]
  );

  // Measure the rendered container so auto-fit can "fill width" instead of the
  // default SVG `meet` (which letterboxes the whole mesh and leaves a big empty
  // band on the right when the provider column is very tall). By fitting to the
  // mesh's FIXED width (MESH_WIDTH), a tall provider column overflows and the
  // user can pan it into view — "auto adjust for space" + "pan providers".
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const measure = () => setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // When autoFit is on we scale so the FULL mesh width fits the container,
  // rather than fitting the whole (possibly very tall) layout. This means a
  // provider column taller than the viewport overflows and the user can pan it
  // into view — "auto adjust for space" + "pan providers". When off we use the
  // user's manual zoom. Panning is always enabled (bounded inside FlowMapSvg).
  const fitZoom = useMemo(() => {
    if (containerSize.w === 0) return 1;
    return Math.max(MIN_ZOOM, containerSize.w / MESH_WIDTH);
  }, [containerSize.w]);

  const effectiveZoom = autoFit ? fitZoom : zoom;

  return (
    <div className="flex flex-col gap-3">
      {!hidePicker && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <MeshKeyPicker
            options={pickerOptions}
            selected={selectedKeys ?? []}
            onSelectionChange={(ids) => setSelectedKeys(ids)}
          />
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> success
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-500" /> queued
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-indigo-500" /> in flight
            </span>
          </div>
        </div>
      )}

      <div
        ref={canvasRef}
        data-flow-canvas
        className={`relative overflow-hidden rounded-lg border bg-background/40 w-full ${
          heightClass ?? "h-[70vh]"
        } ${className ?? ""}`}
      >
        <FlowMapSvg
          keys={meshKeys}
          active={active}
          zoom={effectiveZoom}
          panX={pan.x}
          panY={pan.y}
          onPanChange={(x, y) => setPan({ x, y })}
        />

        {/* Overlay stats */}
        <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-background/80 px-2 py-1 text-xs backdrop-blur">
          <span className="font-semibold">{aggregated.held} held</span>
          <span className="mx-1.5 text-muted-foreground">·</span>
          <span className="font-semibold">{aggregated.inFlight} in flight</span>
          <span className="mx-1.5 text-muted-foreground">·</span>
          <span className="text-muted-foreground">{events.length} events</span>
        </div>

        {/* Zoom / autofit controls */}
        <div className="absolute right-3 top-3">
          <MeshZoomControl
            autoFit={autoFit}
            zoom={autoFit ? fitZoom : zoom}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            onAutoFitToggle={(v) => {
              setAutoFit(v);
              setPan({ x: 0, y: 0 });
            }}
            onZoomChange={(z) => {
              setZoom(z);
              setPan({ x: 0, y: 0 });
              setAutoFit(false); // manual zoom disables auto-fit
            }}
          />
        </div>
      </div>
    </div>
  );
}
