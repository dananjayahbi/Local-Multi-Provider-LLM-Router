// ─── Early Stream Keepalive ─────────────────────────────
// While the upstream provider is cold (model warm-up / queue), the client sits
// with an open connection and NO bytes. Some agent clients interpret a silent
// socket as a stall and abort or retry. Writing ONE immediate no-op frame — and
// repeating it until the first real delta arrives — keeps the connection alive
// and improves perceived responsiveness, WITHOUT buffering the real stream.
//
// The frame MUST be a valid no-op for the client dialect so strict SSE parsers
// do not choke. It is only ever emitted BEFORE the first usable delta; once real
// content flows it stops immediately so it can never interleave.

import { serializeDelta } from "../serializer";
import { CanonicalDelta } from "../canonical";

/** Default interval between keepalive frames while the upstream is still cold. */
export const KEEPALIVE_INTERVAL_MS = 15_000;

/** A keepalive delta: an empty assistant delta that clients safely ignore. */
export function buildKeepaliveDelta(): CanonicalDelta {
  return { choices: [{ index: 0, delta: { role: "assistant" } }] };
}

/**
 * A ready-to-enqueue SSE frame for the OpenAI chat-completions dialect. Clients
 * (Copilot, Zoo Code, Cline, OpenAI SDKs) ignore it for rendering but treat the
 * bytes as proof the stream is live.
 */
export function buildKeepaliveChunk(): string {
  return serializeDelta(buildKeepaliveDelta());
}
