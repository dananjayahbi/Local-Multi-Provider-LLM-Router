// ─── Live Flow Tracker ─────────────────────────────────
// In-memory, real-time event + active-request tracker that powers the
// "data-flow illustration" on the /usage page.
//
// The orchestrator (and gateway) record a small, correlated event stream as
// each request moves through the pipeline:
//
//   arrived → queued → assigned → (success | failed)
//
// `queued` means the request is HELD in the gateway waiting for a key's rate
// limit window to free up (the "requests holding" count). `assigned` means a
// reservation was granted and the upstream call is in flight. The animation
// renders the CURRENT active set (which keys are saturated) plus a rolling
// tail of recent transitions so it feels live.

export type FlowStage = "arrived" | "queued" | "assigned" | "success" | "failed";

export interface FlowEvent {
  id: string;
  /** Correlates all events that belong to the same inbound gateway request. */
  requestId: string;
  poolId: string | null;
  apiKeyId: string | null;
  poolName: string | null;
  apiKeyLabel: string | null;
  providerName: string | null;
  stage: FlowStage;
  ts: number;
  /** Milliseconds spent queued before being assigned (queue depth signal). */
  waitMs?: number;
  /** Provider round-trip latency (assigned → success/failed). */
  latencyMs?: number;
  /** Estimated/actual tokens attached to the request. */
  tokens?: number;
}

export interface ActiveRequest {
  requestId: string;
  poolId: string | null;
  apiKeyId: string | null;
  poolName: string | null;
  apiKeyLabel: string | null;
  providerName: string | null;
  /** `queued` = holding in the gateway; `in_flight` = upstream call active. */
  stage: "queued" | "in_flight";
  startedAt: number;
  waitMs?: number;
  latencyMs?: number;
}

const MAX_EVENTS = 400;
const MAX_ACTIVE = 250;

const eventBuffer: FlowEvent[] = [];
const activeMap = new Map<string, ActiveRequest>();

type EmitInput = Omit<FlowEvent, "id" | "ts"> & { ts?: number };

function upsertActive(event: FlowEvent): void {
  if (event.stage === "queued") {
    activeMap.set(event.requestId, {
      requestId: event.requestId,
      poolId: event.poolId,
      apiKeyId: event.apiKeyId,
      poolName: event.poolName,
      apiKeyLabel: event.apiKeyLabel,
      providerName: event.providerName,
      stage: "queued",
      startedAt: event.ts,
      waitMs: event.waitMs,
    });
  } else if (event.stage === "assigned") {
    const prev = activeMap.get(event.requestId);
    activeMap.set(event.requestId, {
      requestId: event.requestId,
      poolId: event.poolId,
      apiKeyId: event.apiKeyId,
      poolName: event.poolName,
      apiKeyLabel: event.apiKeyLabel,
      providerName: event.providerName,
      stage: "in_flight",
      startedAt: prev?.startedAt ?? event.ts,
      waitMs: prev?.waitMs ?? event.waitMs,
      latencyMs: event.latencyMs,
    });
  } else if (event.stage === "success" || event.stage === "failed") {
    activeMap.delete(event.requestId);
  }
}

/**
 * Record a single pipeline transition. Returns the fully-formed event.
 */
export function recordFlowEvent(input: EmitInput): FlowEvent {
  const event: FlowEvent = { id: crypto.randomUUID(), ts: input.ts ?? Date.now(), ...input };
  eventBuffer.push(event);
  if (eventBuffer.length > MAX_EVENTS) eventBuffer.splice(0, eventBuffer.length - MAX_EVENTS);

  upsertActive(event);
  return event;
}

/**
 * The live snapshot for the /usage animation. `active` holds every request
 * currently inside the gateway (queued or in flight) and `events` is the
 * rolling recent-transition tail.
 */
export function getFlowSnapshot() {
  return {
    active: Array.from(activeMap.values()),
    events: [...eventBuffer],
    counts: summarizeCounts(),
  };
}

/** Aggregate counters for a compact header/legend. */
export function summarizeCounts() {
  let held = 0;
  let inFlight = 0;
  const byKey = new Map<string, { queued: number; inFlight: number }>();

  for (const r of activeMap.values()) {
    if (r.apiKeyId) {
      const bucket = byKey.get(r.apiKeyId) ?? { queued: 0, inFlight: 0 };
      if (r.stage === "queued") bucket.queued++;
      else bucket.inFlight++;
      byKey.set(r.apiKeyId, bucket);
    }
    if (r.stage === "queued") held++;
    else inFlight++;
  }

  // Only surface keys with activity so the legend stays clean.
  const keyMap = new Map(
    Array.from(byKey.entries()).map(([apiKeyId, v]) => [apiKeyId, { apiKeyId, ...v }])
  );

  return {
    held,
    inFlight,
    total: held + inFlight,
    byKey: Array.from(keyMap.values()),
  };
}

/**
 * Drop all tracked state. Used in tests / dev reload so the animation never
 * shows stale frames.
 */
export function resetFlowTracker(): void {
  eventBuffer.length = 0;
  activeMap.clear();
}
