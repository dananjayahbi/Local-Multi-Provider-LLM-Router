// ─── Tool Reliability & Request Shaping ───────────────
// Some provider models (notably OpenRouter's free `stealth/ox-alpha`) return
// a complete-but-EMPTY turn (no content, no tool_calls, HTTP 200) whenever
// `tools` is sent as an array — despite advertising function calling. Strict
// clients like GitHub Copilot then report "no response returned."
//
// The fix: these models are flagged `reliableToolCalling: false` on their
// ProviderModel row. The orchestrator then strips `tools` BEFORE building the
// request, so the model produces real output on the FIRST attempt (no wasted
// round-trip, no empty stream reaching the client).

import { CanonicalRequest } from "../canonical";

/**
 * Strip tools (and tool_choice) from a request. Used for models that return
 * empty completions when given a `tools` array.
 */
export function withoutTools(request: CanonicalRequest): CanonicalRequest {
  return {
    ...request,
    tools: undefined,
    tool_choice: undefined,
  };
}

/** Whether the request carried tools that could trigger the empty-completion bug. */
export function hadTools(request: CanonicalRequest): boolean {
  return Array.isArray(request.tools) && request.tools.length > 0;
}

