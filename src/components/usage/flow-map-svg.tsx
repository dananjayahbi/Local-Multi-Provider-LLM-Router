"use client";

import { useMemo, useRef, useCallback } from "react";
import type { ActiveRequest } from "./use-live-flow";
import { computeFlowMapLayout, FlowMapKeyInput, FlowMapLayout, FlowMapKeyBox } from "./flow-map-layout";
import { useAnimationClock } from "./use-animation-clock";
import { hashPhase, dotAlongPath, tokenParticlePosition, lerp, easeInOutCubic, PathSegment } from "./flow-anim-math";

// ─── Types ──────────────────────────────────────────────

interface FlowMapSvgProps {
  keys: FlowMapKeyInput[];
  active: ActiveRequest[];
  className?: string;
  zoom: number;
  /** pan offset (px) applied in the SVG coordinate space, default 0,0. */
  panX?: number;
  panY?: number;
  onPanChange?: (dx: number, dy: number) => void;
}

const QUEUE_CAP = 8; // max queued request dots shown in the queue box
const REQUEST_DURATION = 2.6; // seconds to travel gateway→key (and loop)
const TOKEN_DURATION = 1.4; // seconds for a token particle to stream back

// ─── Helpers ────────────────────────────────────────────

function saturationColor(s: number): string {
  if (s >= 0.9) return "#ef4444";
  if (s >= 0.65) return "#f59e0b";
  if (s >= 0.3) return "#10b981";
  return "#0ea5e9";
}

// ─── Main Component ─────────────────────────────────────

export function FlowMapSvg({ keys, active, className, zoom, panX = 0, panY = 0, onPanChange }: FlowMapSvgProps) {
  const mesh = useMemo(() => computeFlowMapLayout(keys), [keys]);
  const clock = useAnimationClock(30);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  // ── Pan (drag) handlers ──
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY, panX, panY };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }, [panX, panY]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current || !onPanChange) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    onPanChange(dragRef.current.panX + dx, dragRef.current.panY + dy);
  }, [onPanChange]);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  // ── Split active requests by stage ──
  const queuedRequests = useMemo(() => active.filter((r) => r.stage === "queued"), [active]);
  const inFlightRequests = useMemo(() => active.filter((r) => r.stage === "in_flight"), [active]);

  // Request dots: queued ones stay in the queue box; in-flight ones travel the
  // gateway→key edge (looping). Each is keyed by requestId for stable phases.
  const keyById = useMemo(() => new Map(mesh.edges.map((e) => [e.keyId, e])), [mesh.edges]);

  const responseParticles = useMemo(() => {
    // Each in-flight request emits a short token particle stream back toward the
    // client. We derive a small set of particles per request from its phase.
    const particles: { id: string; keyX: number; keyY: number; progress: number; color: string }[] = [];
    inFlightRequests.forEach((r) => {
      if (!r.apiKeyId) return;
      const keyBox = mesh.providers.flatMap((p) => p.keys).find((k) => k.id === r.apiKeyId);
      if (!keyBox) return;
      const n = Math.min(6, 2 + Math.floor(hashPhase(r.requestId, 0.5) * 4));
      for (let i = 0; i < n; i++) {
        const phase = hashPhase(r.requestId + i, 0.9);
        const progress = (clock * 0.7 + phase) % TOKEN_DURATION / TOKEN_DURATION;
        particles.push({
          id: `${r.requestId}-t${i}`,
          keyX: keyBox.inX,
          keyY: keyBox.inY,
          progress,
          color: keyBox.color,
        });
      }
    });
    return particles;
  }, [inFlightRequests, mesh.providers, clock]);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${mesh.width} ${mesh.height}`}
      preserveAspectRatio="xMidYMid meet"
      className={className ?? "h-full w-full"}
      role="img"
      aria-label="Live request flow between client, gateway and providers"
      style={{ cursor: dragRef.current ? "grabbing" : "grab" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      <g transform={`translate(${panX} ${panY}) scale(${zoom})`}>
        {/* Client → Gateway edge */}
        <line x1={mesh.client.outX} y1={mesh.client.outY} x2={mesh.gateway.inX} y2={mesh.gateway.inY} stroke="#6366f1" strokeWidth={2} strokeOpacity={0.8} strokeDasharray="3 4" />

        {/* Gateway → Key edges */}
        {mesh.edges.map((e) => (
          <line key={e.id} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke={e.color} strokeWidth={e.active ? 2.5 : 1} strokeOpacity={e.active ? 0.9 : 0.25} strokeDasharray={e.active ? undefined : "4 6"} />
        ))}

        {/* ── Client block ── */}
        <ClientBlock x={mesh.client.x} y={mesh.client.y} w={mesh.client.w} h={mesh.client.h} label={mesh.client.label} />

        {/* ── Gateway block (with queue) ── */}
        <g>
          <rect x={mesh.gateway.x} y={mesh.gateway.y} width={mesh.gateway.w} height={mesh.gateway.h} rx={14} fill="#0f172a" stroke="#6366f1" strokeWidth={2.5} />
          <text x={mesh.gateway.x + mesh.gateway.w / 2} y={mesh.gateway.y + 30} textAnchor="middle" fontSize={16} fontWeight={700} fill="#fff">GATEWAY</text>
          <text x={mesh.gateway.x + mesh.gateway.w / 2} y={mesh.gateway.y + 50} textAnchor="middle" fontSize={10} fill="#cbd5e1">request routing + rate-limit queue</text>

          {/* Queue box */}
          <rect x={mesh.queue.x} y={mesh.queue.y} width={mesh.queue.w} height={mesh.queue.h} rx={8} fill="#1e293b" stroke="#475569" strokeWidth={1.5} />
          <text x={mesh.queue.cx} y={mesh.queue.y + 18} textAnchor="middle" fontSize={11} fontWeight={600} fill="#cbd5e1">QUEUE — {queuedRequests.length} held</text>

          {/* Queued request dots live INSIDE the queue box */}
          {queuedRequests.slice(0, QUEUE_CAP).map((r, i) => {
            const cols = 6;
            const row = Math.floor(i / cols);
            const col = i % cols;
            const dotX = mesh.queue.x + 16 + col * ((mesh.queue.w - 32) / cols);
            const dotY = mesh.queue.y + 40 + row * 26;
            return <circle key={r.requestId} cx={dotX} cy={dotY} r={5} fill="#f59e0b" className="animate-pulse" />;
          })}
        </g>

        {/* ── Provider blocks + key chips ── */}
        {mesh.providers.map((p) => (
          <g key={p.id}>
            <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={12} fill="#0f172a" stroke={p.color} strokeWidth={1.5} strokeOpacity={0.6} />
            <text x={p.x + p.w / 2} y={p.y + 22} textAnchor="middle" fontSize={12} fontWeight={600} fill={p.color}>{p.name}</text>
            {p.keys.map((k) => {
              const pct = Math.round(k.saturation * 100);
              return (
                <g key={k.id}>
                  <rect x={k.x} y={k.y} width={k.w} height={k.h} rx={8} fill="#1e293b" stroke={k.color} strokeWidth={1.2} />
                  <text x={k.x + 8} y={k.y + 18} fontSize={11} fontWeight={600} fill="#fff">{k.label}</text>
                  <rect x={k.x + 8} y={k.y + 24} width={k.w - 46} height={5} rx={2} fill="#334155" />
                  <rect x={k.x + 8} y={k.y + 24} width={(k.w - 46) * pct / 100} height={5} rx={2} fill={saturationColor(k.saturation)} />
                  <text x={k.x + k.w - 8} y={k.y + 24} textAnchor="end" fontSize={10} fill="#cbd5e1">{k.rpm}{k.rpmLimit && k.rpmLimit > 0 ? `/${k.rpmLimit}` : ""} rpm</text>
                </g>
              );
            })}
          </g>
        ))}

        {/* ── In-flight request dots traveling gateway→key (loop) ── */}
        {inFlightRequests.map((r) => {
          if (!r.apiKeyId) return null;
          const edge = keyById.get(r.apiKeyId);
          if (!edge) return null;
          const seg: PathSegment = { from: { x: edge.x1, y: edge.y1 }, to: { x: edge.x2, y: edge.y2 } };
          const phase = hashPhase(r.requestId, 1);
          const pos = dotAlongPath(seg, phase, clock, REQUEST_DURATION);
          return <circle key={r.requestId} cx={pos.x} cy={pos.y} r={5} fill={edge.color} />;
        })}

        {/* ── Response token particles (key → gateway → client) ── */}
        {responseParticles.map((p) => {
          const pos = tokenParticlePosition(
            { x: p.keyX, y: p.keyY },
            { x: mesh.gateway.outX, y: mesh.gateway.outY },
            { x: mesh.gateway.inX, y: mesh.gateway.inY },
            { x: mesh.client.outX + 6, y: mesh.client.outY },
            p.progress
          );
          return <circle key={p.id} cx={pos.x} cy={pos.y} r={2.5} fill={p.color} opacity={0.85} />;
        })}

        {/* ── Client → Gateway request dots (arriving from Copilot) ── */}
        {inFlightRequests.slice(0, 3).map((r, i) => {
          const phase = hashPhase(r.requestId + "in", 0.5) + i * 0.1;
          const t = (phase + clock * 0.9) % REQUEST_DURATION / REQUEST_DURATION;
          const x = lerp(mesh.client.outX, mesh.gateway.inX, easeInOutCubic(Math.min(1, t)));
          const y = lerp(mesh.client.outY, mesh.gateway.inY, easeInOutCubic(Math.min(1, t)));
          return <circle key={`in-${r.requestId}`} cx={x} cy={y} r={4} fill="#6366f1" opacity={0.9} />;
        })}
      </g>
    </svg>
  );
}

// ─── Client Block ───────────────────────────────────────

function ClientBlock({ x, y, w, h, label }: { x: number; y: number; w: number; h: number; label: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={14} fill="#0f172a" stroke="#6366f1" strokeWidth={2} />
      <text x={x + w / 2} y={y + h / 2 - 6} textAnchor="middle" fontSize={13} fontWeight={700} fill="#fff">{label}</text>
      <text x={x + w / 2} y={y + h / 2 + 14} textAnchor="middle" fontSize={10} fill="#cbd5e1">requests in</text>
    </g>
  );
}
