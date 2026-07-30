// ─── Response Serializer ────────────────────────────────
// Converts Canonical Response / CanonicalDelta into
// OpenAI chat-completions shape for the client.

import { CanonicalResponse, CanonicalDelta } from "./canonical";

export function serializeResponse(canonical: CanonicalResponse): object {
  return {
    id: canonical.id,
    object: "chat.completion",
    created: canonical.created,
    model: canonical.model,
    choices: canonical.choices.map((choice) => ({
      index: choice.index,
      message: {
        role: choice.message.role,
        content: choice.message.content,
        ...(choice.message.tool_calls && choice.message.tool_calls.length > 0
          ? { tool_calls: choice.message.tool_calls }
          : {}),
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
  const payload: Record<string, unknown> = {
    id: delta.id || "",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: delta.model || "",
    choices: delta.choices.map((c) => ({
      index: c.index,
      delta: c.delta,
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
