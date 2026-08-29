import {
  ProviderAdapter,
  CanonicalRequest,
  CanonicalResponse,
  CanonicalDelta,
  CanonicalMessage,
  CanonicalTool,
  CanonicalMessageData,
  TextContent,
  contentToParts,
  normalizeProviderErrorCode,
} from "../canonical";
import { normalizeCanonicalResponse } from "../response-normalizer";
import { normalizeReasoningDelta, isBareDelta } from "./stream-helpers";

function generateId(): string {
  return "chatcmpl-" + crypto.randomUUID();
}

export const chatCompletionsAdapter: ProviderAdapter = {
  buildRequest(canonical: CanonicalRequest, apiKey: string, baseUrl: string, modelId: string) {
    const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

    const messages: Record<string, unknown>[] = [];
    if (canonical.system) {
      messages.push({ role: "system", content: canonical.system });
    }
    for (const msg of canonical.messages) {
      const entry: Record<string, unknown> = {
        role: msg.role,
        content:
          typeof msg.content === "string"
            ? msg.content
            : Array.isArray(msg.content)
              ? msg.content
                  .filter((c): c is TextContent => c.type === "text")
                  .map((c) => c.text)
                  .join("")
              : msg.content,
      };
      if (msg.name) entry.name = msg.name;
      if (msg.tool_call_id) entry.tool_call_id = msg.tool_call_id;
      // CRITICAL: forward the assistant's tool_calls so the upstream model can
      // pair them with the following `tool`-role results. Without this, a tool
      // result has no anchor and the model keeps re-issuing the same tool
      // (Copilot's repeated "Added todo" / "Updated todo list" loop).
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        entry.tool_calls = msg.tool_calls;
      }
      messages.push(entry);
    }

    const body: Record<string, unknown> = {
      model: modelId,
      messages,
      stream: canonical.stream ?? false,
    };

    if (canonical.temperature != null) body.temperature = canonical.temperature;
    if (canonical.max_tokens != null) body.max_tokens = canonical.max_tokens;
    if (canonical.top_p != null) body.top_p = canonical.top_p;
    if (canonical.tools) body.tools = canonical.tools;
    if (canonical.tool_choice) body.tool_choice = canonical.tool_choice;
    if (canonical.stop) body.stop = canonical.stop;
    if (canonical.stream) body.stream_options = { include_usage: true };

    return {
      url,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    };
  },

  parseResponse(responseBody: string, _statusCode: number): CanonicalResponse {
    const raw = JSON.parse(responseBody);
    const choices = (raw.choices || []).map((c: Record<string, unknown>, i: number) => {
      const msg = (c.message as Record<string, unknown>) || {};
      const reasoning = (msg.reasoning as string) || undefined;
      const reasoning_content = (msg.reasoning_content as string) || undefined;
      return {
        index: c.index ?? i,
        message: {
          role: "assistant" as const,
          content: (msg.content as string | null) ?? null,
          tool_calls: (msg.tool_calls as CanonicalMessageData["tool_calls"]) ?? undefined,
          // Pass reasoning through so Copilot renders the collapsible Thinking UI.
          ...(reasoning ? { reasoning } : {}),
          ...(reasoning_content ? { reasoning_content } : {}),
        },
        finish_reason: (c.finish_reason as CanonicalResponse["choices"][0]["finish_reason"]) ?? null,
      };
    });

    return normalizeCanonicalResponse({
      id: raw.id || generateId(),
      model: raw.model || "",
      choices,
      usage: raw.usage
        ? {
            prompt_tokens: raw.usage.prompt_tokens ?? 0,
            completion_tokens: raw.usage.completion_tokens ?? 0,
            total_tokens: raw.usage.total_tokens ?? 0,
          }
        : undefined,
      created: raw.created ?? Math.floor(Date.now() / 1000),
    });
  },

  parseStreamChunk(chunk: string): CanonicalDelta | null {
    const trimmed = chunk.trim();
    if (!trimmed || trimmed === "data: [DONE]") return null;

    const lines = trimmed.split("\n").filter((l) => l.startsWith("data: "));
    for (const line of lines) {
      const json = line.slice(6).trim();
      if (!json || json === "[DONE]") continue;
      try {
        const raw = JSON.parse(json);
        const choices = (raw.choices || []).map((c: Record<string, unknown>) => ({
          index: c.index ?? 0,
          delta: (c.delta || {}) as CanonicalDelta["choices"][0]["delta"],
          finish_reason: c.finish_reason ?? undefined,
        }));
        const usage = raw.usage as CanonicalDelta["usage"];
        // A final usage-only terminal chunk (OpenAI/OpenRouter/DeepSeek emit
        // `choices: []` with a populated `usage` at stream end). Dropping it
        // would discard the ONLY source of streamed prompt/completion counts —
        // the root cause of pools showing zero tokens. Return it so the
        // orchestrator can capture usage even though there are no choices.
        if (choices.length === 0) {
          if (usage) return { id: raw.id, model: raw.model, choices: [], usage };
          continue;
        }
        let canon: CanonicalDelta = {
          id: raw.id,
          model: raw.model,
          choices: choices as CanonicalDelta["choices"],
          usage,
        };
        // Pass reasoning through so GitHub Copilot renders the collapsible
        // Thinking UI. Normalize OpenRouter's reasoning_details (array) into
        // the string (`reasoning`) field Copilot actually reads.
        canon = normalizeReasoningDelta(canon);
        // Drop deltas that carry nothing usable (no content, no reasoning, no
        // tool calls, no finish_reason) — pure heartbeats confuse clients.
        const hasTerminal = canon.choices.some((c) => c.finish_reason != null);
        if (isBareDelta(canon) && !hasTerminal) continue;
        return canon;
      } catch {
        return null;
      }
    }
    return null;
  },

  parseError(responseBody: string, statusCode: number) {
    try {
      const raw = JSON.parse(responseBody);
      return {
        httpStatus: statusCode,
        providerErrorMessage: raw.error?.message || raw.message || `HTTP ${statusCode}`,
        providerErrorCode: normalizeProviderErrorCode(raw.error?.code || raw.error?.type),
      };
    } catch {
      return {
        httpStatus: statusCode,
        providerErrorMessage: `HTTP ${statusCode}`,
        providerErrorCode: null,
      };
    }
  },
};
