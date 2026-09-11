// ─── Response Serializer ────────────────────────────────
// Converts Canonical Response / CanonicalDelta into
// OpenAI chat-completions shape for the client.

import { CanonicalResponse, CanonicalDelta } from "./canonical";
import { normalizeCanonicalResponse } from "./response-normalizer";
import { defaultCapabilities, ClientCapabilities } from "./clients/client-profile";
import { bridgeReasoningToContent } from "./adapters/stream-helpers";

export function serializeResponse(
  canonical: CanonicalResponse,
  caps: ClientCapabilities = defaultCapabilities()
): object {
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
        // For clients that ignore `reasoning*`, mirror a reasoning-only turn
        // into `content` so the turn never renders empty.
        content:
          caps.bridgeReasoningToContent &&
          !choice.message.content &&
          (choice.message.reasoning_content || choice.message.reasoning)
            ? choice.message.reasoning_content || choice.message.reasoning
            : choice.message.content,
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

export function serializeDelta(
  delta: CanonicalDelta,
  caps: ClientCapabilities = defaultCapabilities()
): string {
  // Skip deltas that carry nothing usable — pure heartbeats (no choices AND
  // no usage). A usage-only terminal chunk (empty choices[] + populated usage
  // object) MUST be forwarded so Copilot's Context Window indicator receives
  // its token counts. OpenAI sends exactly `{"choices":[],"usage":{...}}`
  // before `data: [DONE]` when `stream_options.include_usage=true`, and VS Code's
  // Copilot SSEProcessor reads `usage` independently of `choices`.
  const hasUsage = delta.usage != null;
  if ((!delta.choices || delta.choices.length === 0) && !hasUsage) {
    return "";
  }

  // Mirror reasoning into `content` for clients that ignore `reasoning*`
  // (universal profile). No-op for Copilot, so its Thinking UI is unchanged.
  const bridged = bridgeReasoningToContent(delta, caps.bridgeReasoningToContent);

  const payload: Record<string, unknown> = {
    id: bridged.id || "",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: bridged.model || "",
    choices: (bridged.choices || []).map((c) => ({
      index: c.index,
      delta: c.delta ?? {}, // some providers omit delta — ensure {} so JSON.stringify never drops it
      finish_reason: c.finish_reason ?? null,
    })),
  };
  if (hasUsage) {
    payload.usage = delta.usage;
  }
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export function serializeStreamEnd(): string {
  return "data: [DONE]\n\n";
}
