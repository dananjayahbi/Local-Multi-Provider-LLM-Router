// ─── Exhausted Pool Response ────────────────────────────
// When a pool has NO routable (healthy) key — every member key is PENALIZED,
// SUSPENDED, DISABLED, or the pool simply has no active key — we never want to
// surface a hard error to the agent. An autonomous Copilot would just retry
// forever and burn tokens. Instead, the gateway returns a *valid* OpenAI
// assistant completion that:
//
//   1. Carries the predefined "pool exhausted" message as `content`.
//   2. Contains NO `tool_calls`.
//   3. Ends with `finish_reason: "stop"` (NOT `"tool_calls"`).
//
// Why this ends the chat: the CLI's tool-use loop is purely mechanical —
// "model asked for tools → execute → call the model again." A plain final text
// answer with no tool request makes the model stop, emitting `session.idle`,
// which is the reliable "done" signal. Returning an error (or a response that
// nudges more tool calls) keeps the loop alive and defeats autonomous work.

import { CanonicalResponse, CanonicalDelta } from "../canonical";

/**
 * Machine-detectable marker prefixed to the exhausted message for universal
 * (non-Copilot) clients so an agent / wrapper can distinguish a routing OUTAGE
 * from a genuine "task complete" answer and back off instead of treating it as
 * a final result. Copilot keeps the plain message (it relies on the mechanical
 * tool-loop termination and must not see extra text).
 */
export const EXHAUSTED_POOL_MARKER = "[ROUTER-OUTAGE]";

/** Predefined message surfaced to the agent when every key in a pool is exhausted. */
export const EXHAUSTED_POOL_MESSAGE = [
  "This is an output message from the gateway:",
  "The current pool is exhausted and there are no healthy keys remaining to route.",
  "Please wait until a penalty is removed from a key, then you may continue.",
  "You can check the gateway dashboard (Pools & Logs tabs) for more information.",
].join("\n\n");

/** The exhausted message as surfaced to a given client (marker for universal). */
export function exhaustedMessageFor(emitOutageMarker: boolean): string {
  return emitOutageMarker
    ? `${EXHAUSTED_POOL_MARKER} ${EXHAUSTED_POOL_MESSAGE}`
    : EXHAUSTED_POOL_MESSAGE;
}

/** Machine-readable classification written to RequestLog for this case. */
export const NO_HEALTHY_KEY_CLASSIFICATION = "NO_HEALTHY_KEY";

/** Whether a canonical response is one of our synthetic "exhausted" responses. */
export function isExhaustedPoolResponse(resp: CanonicalResponse): boolean {
  const content = resp.choices?.[0]?.message?.content;
  return typeof content === "string" && content.includes(EXHAUSTED_POOL_MESSAGE);
}

/**
 * Build a complete, non-streamed assistant completion for the exhausted case.
 * `finish_reason: "stop"` + no tool_calls => the agent ends its turn.
 */
export function buildExhaustedPoolResponse(
  model: string,
  message: string = EXHAUSTED_POOL_MESSAGE
): CanonicalResponse {
  return {
    id: `exhausted-${Date.now()}`,
    model,
    created: Math.floor(Date.now() / 1000),
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: message,
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

/**
 * Build a streaming assistant completion for the exhausted case. Emits the
 * message in one delta, then a terminal `finish_reason: "stop"` chunk so the
 * client still sees a well-formed SSE stream that ends cleanly.
 */
export async function* buildExhaustedPoolStream(
  model: string,
  message: string = EXHAUSTED_POOL_MESSAGE
): AsyncGenerator<CanonicalDelta> {
  const id = `exhausted-${Date.now()}`;
  yield {
    id,
    model,
    choices: [{ index: 0, delta: { role: "assistant", content: message } }],
  };
  yield {
    id,
    model,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  };
}
