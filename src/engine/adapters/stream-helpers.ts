// ─── Stream Reasoning Helpers ─────────────────────────
// Reasoning-capable models (e.g. stealth/ox-alpha, DeepSeek-R1) stream their
// chain-of-thought in `delta.reasoning` (OpenRouter, string), `delta.reasoning_content`
// (DeepSeek/Moonshot/Minimax, string) or `delta.reasoning_details` (OpenRouter,
// array of `{ text }`). GitHub Copilot natively reads these fields and renders
// a COLLAPSIBLE "Thinking" UI from them — verified in microsoft/vscode source
// `extensions/copilot/src/platform/thinking/common/thinkingUtils.ts`.
//
// Copilot's `extractThinkingDeltaFromChoice()` reads TEXT by priority:
//   cot_summary -> reasoning_text -> reasoning_content -> reasoning -> thinking
// It does NOT need reasoning inside `content`. Bridging reasoning into `content`
// (as plain `> thinking:` text) makes Copilot render it as normal answer text,
// and stripping the reasoning fields makes reasoning-only streams yield nothing
// ("no response returned").
//
// These helpers therefore: (1) normalize reasoning so Copilot sees a STRING in
// a field it reads, and (2) bridge reasoning into `content` ONLY when the
// resolved client capabilities ask for it (`bridgeReasoningToContent`). Generic
// OpenAI-compatible agents (Zoo Code, Cline, ...) ignore the `reasoning*` fields,
// so for them a reasoning-only turn MUST also appear in `content` or the turn
// looks EMPTY and the agent re-plans in a loop. Copilot keeps its collapsible
// Thinking UI untouched because the default profile never bridges.

import { CanonicalDelta } from "../canonical";

/**
 * Normalize a streamed delta's reasoning so Copilot reads it as a STRING in a
 * field it understands: `reasoning_content` (DeepSeek) or `reasoning`
 * (OpenRouter, after flattening `reasoning_details` array). Returns a NEW delta.
 */
export function normalizeReasoningDelta(delta: CanonicalDelta): CanonicalDelta {
  const newChoices = delta.choices.map((choice) => {
    const d = choice.delta ?? {};
    const raw = d as Record<string, unknown>;
    const next: Record<string, unknown> = { ...raw };

    // Flatten OpenRouter's array form into the string Copilot reads.
    if (Array.isArray(raw.reasoning_details)) {
      const text = (raw.reasoning_details as Array<{ text?: unknown }>)
        .map((rd) => (typeof rd.text === "string" ? rd.text : ""))
        .filter((t) => t.length > 0)
        .join("");
      if (!next.reasoning) next.reasoning = text;
      delete next.reasoning_details;
    }

    return { ...choice, delta: next as CanonicalDelta["choices"][0]["delta"] };
  });
  return { ...delta, choices: newChoices };
}

/** Whether a delta carries no content AND no reasoning AND no tool calls. */
export function isBareDelta(delta: CanonicalDelta): boolean {
  return delta.choices.every((c) => {
    const d = c.delta ?? {};
    const raw = d as Record<string, unknown>;
    if (typeof d.content === "string" && d.content.length > 0) return false;
    if (Array.isArray(d.tool_calls) && d.tool_calls.length > 0) return false;
    if (typeof raw.reasoning === "string" && raw.reasoning.length > 0) return false;
    if (typeof raw.reasoning_content === "string" && raw.reasoning_content.length > 0) return false;
    return true;
  });
}

/**
 * Mirror reasoning into `content` for clients that ignore the `reasoning*`
 * fields (`bridge` flag). The reasoning fields are KEPT so a dual-capable client
 * still renders its Thinking UI. Only a reasoning-only delta is bridged — a
 * delta that already carries real `content` is left untouched so we never
 * duplicate or reorder the answer text.
 *
 * When `bridge` is false this is a strict no-op, so the Copilot path is
 * byte-for-byte unchanged.
 */
export function bridgeReasoningToContent(delta: CanonicalDelta, bridge: boolean): CanonicalDelta {
  if (!bridge) return delta;
  const choices = delta.choices.map((choice) => {
    const d = choice.delta ?? {};
    const raw = d as Record<string, unknown>;
    const hasContent = typeof d.content === "string" && d.content.length > 0;
    if (hasContent) return choice;
    const reasoning =
      (typeof raw.reasoning_content === "string" && raw.reasoning_content) ||
      (typeof raw.reasoning === "string" && raw.reasoning) ||
      "";
    if (!reasoning) return choice;
    return { ...choice, delta: { ...(d as object), content: reasoning } };
  });
  return { ...delta, choices };
}

/** Finish reasons that indicate the model requested one or more tool calls. */
export function deltaHasToolCalls(delta: CanonicalDelta): boolean {
  return delta.choices.some((c) => {
    const d = c.delta ?? {};
    return Array.isArray(d.tool_calls) && d.tool_calls.length > 0;
  });
}

/**
 * Resolve the terminal `finish_reason`: if the turn actually produced tool
 * calls, it MUST be reported as `tool_calls` — otherwise an agent never
 * executes the tool and instead re-plans (a loop). Terminal intent from the
 * upstream is otherwise preserved.
 */
export function resolveFinishReason(
  sawToolCalls: boolean,
  upstream: CanonicalDelta["choices"][0]["finish_reason"] | undefined
): CanonicalDelta["choices"][0]["finish_reason"] {
  if (sawToolCalls) return "tool_calls";
  return upstream ?? "stop";
}
