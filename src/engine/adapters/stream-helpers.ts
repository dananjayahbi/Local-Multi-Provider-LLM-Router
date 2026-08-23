// ─── Stream Reasoning Helpers ─────────────────────────
// Reasoning-capable models (e.g. stealth/ox-alpha, DeepSeek-R1) stream their
// chain-of-thought in `delta.reasoning` / `delta.reasoning_details` while
// `delta.content` stays "". Strict OpenAI-compatible clients (GitHub Copilot,
// `openai` SDK, vLLM, etc.) only render `delta.content`, so they see an empty
// answer and report "no response returned."
//
// These helpers bridge reasoning into `content` so the client always receives
// visible text. Reasoning is surfaced as a visible "> thinking:" block only
// while the model has not yet started emitting real content; once real content
// begins the bridging stops so the answer isn't polluted with raw thoughts.

import { CanonicalDelta } from "../canonical";

/** Marker prefixing the first reasoning chunk in a stream. */
const THINKING_PREFIX = "> thinking: ";

/** Vendor reasoning fields that a strict chat-completions client must never see. */
const REASONING_KEYS = ["reasoning", "reasoning_details", "reasoning_content"] as const;

/**
 * Strip non-standard vendor fields (reasoning / reasoning_details /
 * reasoning_content) from a streamed delta so a strict OpenAI chat-completions
 * parser (GitHub Copilot, `openai` SDK, vLLM) only sees `content`, `role`,
 * `tool_calls`. Returns a NEW delta; the original is untouched.
 */
export function sanitizeStreamDelta(delta: CanonicalDelta): CanonicalDelta {
  const newChoices = delta.choices.map((choice) => {
    const d = choice.delta ?? {};
    const clean: Record<string, unknown> = {};
    // Whitelist only the standard chat-completions delta keys.
    if (typeof d.content === "string") clean.content = d.content;
    if (d.role) clean.role = d.role;
    if (Array.isArray(d.tool_calls)) clean.tool_calls = d.tool_calls;
    for (const k of REASONING_KEYS) delete clean[k];
    return { ...choice, delta: clean as CanonicalDelta["choices"][0]["delta"] };
  });
  return { ...delta, choices: newChoices };
}

/** Per-request bridger state so consecutive reasoning chunks read naturally. */
export class ReasoningBridger {
  private startedContent = false;
  private emmittedReasoning = false;

  /** Reset for a new response stream. */
  reset(): void {
    this.startedContent = false;
    this.emmittedReasoning = false;
  }

  /**
   * Normalize a streamed delta: bridge reasoning->content while the model is
   * still thinking (no real content emitted yet). Returns a NEW delta.
   * The FIRST reasoning chunk gets a "> thinking:" prefix; subsequent ones are
   * joined without a runaway run-on.
   */
  surface(delta: CanonicalDelta): CanonicalDelta {
    const reasoning = delta.choices.map((c) => extractReasoning(c.delta ?? {}));
    const anyReasoning = reasoning.some((r) => r != null);

    // If real content has started, stop bridging (model is answering now).
    if (this.startedContent) return delta;

    // If this delta carries real content, mark content started and pass through.
    if (delta.choices.some((c) => typeof c.delta?.content === "string" && c.delta.content.length > 0)) {
      this.startedContent = true;
      return delta;
    }

    if (!anyReasoning) return delta;

    const newChoices = delta.choices.map((choice, i) => {
      const text = reasoning[i];
      const content = choice.delta?.content ?? "";
      const prefix = this.emmittedReasoning ? "" : THINKING_PREFIX;
      const bridged = text ? `${prefix}${text}` : "";
      this.emmittedReasoning = true;
      const clean: Record<string, unknown> = {};
      if (typeof content === "string" && content.length > 0) clean.content = content;
      else if (bridged) clean.content = bridged;
      if (choice.delta?.role) clean.role = choice.delta.role;
      if (Array.isArray(choice.delta?.tool_calls)) clean.tool_calls = choice.delta.tool_calls;
      return { ...choice, delta: clean as CanonicalDelta["choices"][0]["delta"] };
    });

    return { ...delta, choices: newChoices };
  }
}

/**
 * Return the reasoning text carried by a single streaming delta, if any.
 * Handles both `delta.reasoning` (string) and `delta.reasoning_details`
 * (array of `{ text }` blocks) as emitted by OpenRouter/reasoning models.
 */
export function extractReasoning(delta: CanonicalDelta["choices"][0]["delta"]): string | null {
  const d = delta as Record<string, unknown>;

  // Common shapes: delta.reasoning (string)
  if (typeof d.reasoning === "string" && (d.reasoning as string).length > 0) {
    return d.reasoning as string;
  }

  // OpenRouter "reasoning_details": [{ type, text, index }]
  if (Array.isArray(d.reasoning_details)) {
    const texts = (d.reasoning_details as Array<{ text?: unknown }>)
      .map((rd) => (typeof rd.text === "string" ? rd.text : ""))
      .filter((t) => t.length > 0);
    if (texts.length > 0) return texts.join("");
  }

  // DeepSeek-style "reasoning_content"
  if (typeof d.reasoning_content === "string" && (d.reasoning_content as string).length > 0) {
    return d.reasoning_content as string;
  }

  return null;
}

/**
 * Normalize a streamed delta: if the model emitted reasoning but no content
 * yet, surface the reasoning as content (wrapped) so the client never sees an
 * empty chunk. Returns a NEW delta object (original is untouched).
 */

/** Whether a delta contains any usable content (text or tool calls). */
export function hasUsableContent(delta: CanonicalDelta): boolean {
  return delta.choices.some((c) => {
    const d = c.delta ?? {};
    if (typeof d.content === "string" && d.content.length > 0) return true;
    if (Array.isArray(d.tool_calls) && d.tool_calls.length > 0) return true;
    return false;
  });
}
