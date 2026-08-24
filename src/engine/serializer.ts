// ─── Response Serializer ────────────────────────────────
// Converts Canonical Response / CanonicalDelta into
// OpenAI chat-completions shape for the client.

import { CanonicalResponse, CanonicalDelta } from "./canonical";
import { normalizeCanonicalResponse } from "./response-normalizer";

export function serializeResponse(canonical: CanonicalResponse): object {
  const normalized = normalizeCanonicalResponse(canonical);
  return {
    id: normalized.id,
    object: "chat.completion",
    created: normalized.created,
    model: normalized.model,
    choices: normalized.choices.map((choice) => ({
      index: choice.index,
      message: {
        role: choice.message.role,
        content: choice.message.content,
        ...(choice.message.tool_calls && choice.message.tool_calls.length > 0
          ? { tool_calls: choice.message.tool_calls }
          : {}),
        // Pass reasoning through so Copilot renders the collapsible Thinking UI.
        ...(choice.message.reasoning ? { reasoning: choice.message.reasoning } : {}),
        ...(choice.message.reasoning_content ? { reasoning_content: choice.message.reasoning_content } : {}),
      },
      finish_reason: choice.finish_reason,
    })),
    usage: canonical.usage
      ? {
          prompt_tokens: canonical.usage.prompt_tokens,
          completion_tokens: canonical.usage.completion_tokens,
          total_tokens: canonical.usage.total_tokens,
        }
      : undefined,
  };
}

export function serializeDelta(delta: CanonicalDelta): string {
  // Skip deltas with no choices — some providers emit empty-choice chunks
  // (e.g., during tool-call handoffs) that would break Copilot.
  if (!delta.choices || delta.choices.length === 0) {
    return "";
  }

  const payload: Record<string, unknown> = {
    id: delta.id || "",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: delta.model || "",
    choices: delta.choices.map((c) => ({
      index: c.index,
      delta: c.delta ?? {}, // some providers omit delta — ensure {} so JSON.stringify never drops it
      finish_reason: c.finish_reason ?? null,
    })),
  };
  if (delta.usage) {
    payload.usage = delta.usage;
  }
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export function serializeStreamEnd(): string {
  return "data: [DONE]\n\n";
}
