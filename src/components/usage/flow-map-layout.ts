// ─── Flow-Map Layout (pure geometry) ───────────────────
// Three-container left→right layout:
//   [ Client / Copilot ] → [ Gateway (with internal queue) ] → [ Providers ]
// Kept as a pure module so the SVG renderer stays thin and the geometry is
// testable and reusable by the fullscreen page.

export interface FlowMapKeyInput {
  id: string;
  label: string;
  providerName: string;
  rpm: number;
  rpmLimit: number | null;
  queued: number;
  inFlight: number;
}

export interface FlowMapKeyBox {
  id: string;
  label: string;
  providerName: string;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rpm: number;
  rpmLimit: number | null;
  saturation: number;
  inFlight: number;
  /** Left-edge anchor where request dots enter from the gateway. */
  inX: number;
  inY: number;
}

export interface FlowMapProviderBox {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
  keys: FlowMapKeyBox[];
}

export interface FlowMapEdge {
  id: string;
  keyId: string;
  providerName: string;
  color: string;
  /** Gateway right-edge anchor. */
  x1: number;
  y1: number;
  /** Key-box left-edge anchor. */
  x2: number;
  y2: number;
  /** True when a request is traveling/holding this edge (highlight). */
  active: boolean;
}

export interface FlowMapLayout {
  width: number;
  height: number;
  client: { x: number; y: number; w: number; h: number; label: string; outX: number; outY: number };
  gateway: {
    x: number; y: number; w: number; h: number;
    label: string;
    inX: number; inY: number;   // left edge (from client)
    outX: number; outY: number; // right edge (to providers)
  };
  queue: { x: number; y: number; w: number; h: number; label: string; cx: number; cy: number };
  providers: FlowMapProviderBox[];
  edges: FlowMapEdge[];
}

const PROVIDER_COLORS = [
  "#65a30d", "#10b981", "#22c55e", "#a3e635", "#059669",
  "#84cc16", "#16a34a", "#f59e0b", "#bef264", "#4ade80",
];

export function providerColor(providerName: string): string {
  let hash = 0;
  for (let i = 0; i < providerName.length; i++) hash = (hash * 31 + providerName.charCodeAt(i)) | 0;
  return PROVIDER_COLORS[Math.abs(hash) % PROVIDER_COLORS.length];
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export const MESH_WIDTH = 1400;
const W = MESH_WIDTH;
const CLIENT_W = 190;
const GATEWAY_W = 280;
const PROVIDER_X = 1010;
const PROVIDER_W = 360;

// Provider geometry — each provider box sizes itself to its actual key count so
// nothing overflows. Keys render at a fixed pitch; the parent box and the whole
// canvas grow to accommodate them ("auto adjust for space").
const PROVIDER_PAD_TOP = 18;
const PROVIDER_PAD_BOTTOM = 18;
const LABEL_H = 40;
const KEY_H = 48;
const KEY_GAP = 10;
const KEY_W = PROVIDER_W - 20;
const PROVIDER_GAP = 24;
const TOP_PAD = 60;
const BOTTOM_PAD = 60;

/**
 * Build the 3-container layout. Providers are stacked on the right column, each
 * sized to fit ALL of its key chips (plus padding), so a provider with many keys
 * gets a taller box and the canvas grows to fit. One edge per key runs from the
 * gateway's right edge to the key's left edge so a request dot visibly routes to
 * the exact key.
 */
export function computeFlowMapLayout(keys: FlowMapKeyInput[]): FlowMapLayout {
  // Group keys by provider.
  const byProvider = new Map<string, FlowMapKeyInput[]>();
  for (const k of keys) {
    const list = byProvider.get(k.providerName) ?? [];
    list.push(k);
    byProvider.set(k.providerName, list);
  }
  const providerNames = Array.from(byProvider.keys());

  // Stack provider boxes vertically. Each provider's height = header + its key
  // chips + padding (never clipped). The canvas height is the sum of all boxes
  // plus gaps and top/bottom padding — i.e. the layout grows to fit content.
  const providerHeights = providerNames.map((pname) => {
    const pKeys = byProvider.get(pname)!;
    const keysHeight = pKeys.length * KEY_H + Math.max(0, pKeys.length - 1) * KEY_GAP;
    return PROVIDER_PAD_TOP + LABEL_H + keysHeight + PROVIDER_PAD_BOTTOM;
  });
  const totalProviderGap = PROVIDER_GAP * Math.max(0, providerNames.length - 1);
  const H =
    keys.length === 0
      ? Math.max(360, TOP_PAD + BOTTOM_PAD + 240)
      : TOP_PAD + BOTTOM_PAD + providerHeights.reduce((a, b) => a + b, 0) + totalProviderGap;

  const cy = H / 2;

  const client = { x: 28, y: cy - 60, w: CLIENT_W, h: 120, label: "Copilot / Client", outX: 28 + CLIENT_W, outY: cy };
  const gateway = {
    x: 560, y: cy - 170, w: GATEWAY_W, h: 340,
    label: "Gateway",
    inX: 560, inY: cy,
    outX: 560 + GATEWAY_W, outY: cy,
  };
  const queue = {
    x: gateway.x + 18, y: cy - 70, w: gateway.w - 36, h: 116,
    label: "Queue", cx: gateway.x + gateway.w / 2, cy,
  };

  const providers: FlowMapProviderBox[] = [];
  const edges: FlowMapEdge[] = [];

  let cursorY = TOP_PAD;

  providerNames.forEach((pname, idx) => {
    const pKeys = byProvider.get(pname)!;
    const color = providerColor(pname);
    const h = providerHeights[idx];
    const box = { id: `prov-${pname}`, name: pname, color, x: PROVIDER_X, y: cursorY, w: PROVIDER_W, h, keys: [] as FlowMapKeyBox[] };

    // Provider label is vertically centered in the header band.
    const startY = cursorY + PROVIDER_PAD_TOP + LABEL_H;
    pKeys.forEach((k, i) => {
      const ky = startY + i * (KEY_H + KEY_GAP);
      const saturation =
        k.rpmLimit && k.rpmLimit > 0 ? clamp01(k.rpm / k.rpmLimit) : clamp01(k.rpm / 60);
      box.keys.push({
        id: k.id,
        label: k.label,
        providerName: k.providerName,
        color,
        x: PROVIDER_X + 10,
        y: ky,
        w: KEY_W,
        h: KEY_H,
        rpm: k.rpm,
        rpmLimit: k.rpmLimit,
        saturation,
        inFlight: k.inFlight,
        inX: PROVIDER_X + 10,
        inY: ky + KEY_H / 2,
      });
      edges.push({
        id: `edge-${k.id}`,
        keyId: k.id,
        providerName: k.providerName,
        color,
        x1: gateway.outX,
        y1: gateway.outY,
        x2: PROVIDER_X + 10,
        y2: ky + KEY_H / 2,
        active: k.inFlight > 0 || k.queued > 0,
      });
    });

    providers.push(box);
    cursorY += h + PROVIDER_GAP;
  });

  return { width: W, height: H, client, gateway, queue, providers, edges };
}
