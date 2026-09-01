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
// a field it reads, and (2) never bridge reasoning into `content`.

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
