import {
  ProviderAdapter,
  CanonicalRequest,
  CanonicalResponse,
  CanonicalDelta,
  CanonicalMessage,
  CanonicalTool,
  contentToParts,
} from "../canonical";
import { normalizeCanonicalResponse } from "../response-normalizer";

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
        content: msg.content,
      };
      if (msg.name) entry.name = msg.name;
      if (msg.tool_call_id) entry.tool_call_id = msg.tool_call_id;
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
    const choices = (raw.choices || []).map((c: Record<string, unknown>, i: number) => ({
      index: c.index ?? i,
      message: {
        role: "assistant" as const,
        content: (c.message as Record<string, unknown>)?.content ?? null,
        tool_calls: (c.message as Record<string, unknown>)?.tool_calls ?? undefined,
      },
      finish_reason: (c.finish_reason as CanonicalResponse["choices"][0]["finish_reason"]) ?? null,
    }));

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
        // Providers sometimes emit empty choices[] between tool-call handoffs
        if (choices.length === 0) continue;
        return {
          id: raw.id,
          model: raw.model,
          choices: choices as CanonicalDelta["choices"],
          usage: raw.usage,
        };
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
        providerErrorCode: raw.error?.code || raw.error?.type || null,
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
