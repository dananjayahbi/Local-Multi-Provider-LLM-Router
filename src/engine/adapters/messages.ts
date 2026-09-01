import {
  ProviderAdapter,
  CanonicalRequest,
  CanonicalResponse,
  CanonicalDelta,
  contentToParts,
  ContentPart,
  normalizeProviderErrorCode,
} from "../canonical";

function generateId(): string {
  return "msg-" + crypto.randomUUID();
}

export const messagesAdapter: ProviderAdapter = {
  buildRequest(canonical: CanonicalRequest, apiKey: string, baseUrl: string, modelId: string) {
    const url = `${baseUrl.replace(/\/+$/, "")}/messages`;

    const body: Record<string, unknown> = {
      model: modelId,
      max_tokens: canonical.max_tokens ?? 4096,
      stream: canonical.stream ?? false,
    };

    // Extract system messages
    const systemMessages: string[] = [];
    if (canonical.system) systemMessages.push(canonical.system);
    const nonSystemMessages = canonical.messages.filter((m) => {
      if (m.role === "system") {
        systemMessages.push(
          typeof m.content === "string" ? m.content : m.content.map((c) => ("text" in c ? c.text : "")).join(" ")
        );
        return false;
      }
      return true;
    });

    if (systemMessages.length > 0) {
      body.system = systemMessages.join("\n");
    }

    // Map messages
    const messages = nonSystemMessages.map((msg) => {
      const entry: Record<string, unknown> = { role: msg.role };
      const parts = contentToParts(msg.content);

      // Anthropic expects content as an array of content blocks
      const contentBlocks = parts.map((part) => {
        if (part.type === "text") {
          return { type: "text", text: part.text };
        }
        if (part.type === "image_url") {
          return {
            type: "image",
            source: {
              type: "url",
              url: part.image_url.url,
            },
          };
        }
        return { type: "text", text: "" };
      });

      entry.content = contentBlocks;
      if (msg.tool_call_id) entry.tool_call_id = msg.tool_call_id;
      return entry;
    });

    body.messages = messages;

    // Map tools
    if (canonical.tools && canonical.tools.length > 0) {
      body.tools = canonical.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }

    if (canonical.temperature != null) body.temperature = canonical.temperature;
    if (canonical.top_p != null) body.top_p = canonical.top_p;
    if (canonical.max_tokens != null) body.max_tokens = canonical.max_tokens;

    return {
      url,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    };
  },

  parseResponse(responseBody: string, _statusCode: number): CanonicalResponse {
    const raw = JSON.parse(responseBody);
    const content = raw.content || [];

    // Build message from content blocks
    let textContent: string | null = null;
    const toolCalls: CanonicalResponse["choices"][0]["message"]["tool_calls"] = [];

    for (const block of content) {
      if (block.type === "text") {
        textContent = (textContent || "") + block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id || "",
          type: "function",
          function: {
            name: block.name || "",
            arguments: JSON.stringify(block.input || {}),
          },
        });
      }
    }

    const finishReasonMap: Record<string, CanonicalResponse["choices"][0]["finish_reason"]> = {
      end_turn: "stop",
      max_tokens: "length",
      tool_use: "tool_calls",
      stop_sequence: "stop",
    };

    return {
      id: raw.id || generateId(),
      model: raw.model || "",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: textContent,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          },
          finish_reason: finishReasonMap[raw.stop_reason] || null,
        },
      ],
      usage: raw.usage
        ? {
            prompt_tokens: raw.usage.input_tokens ?? 0,
            completion_tokens: raw.usage.output_tokens ?? 0,
            total_tokens: (raw.usage.input_tokens ?? 0) + (raw.usage.output_tokens ?? 0),
          }
        : undefined,
      created: Math.floor(Date.now() / 1000),
    };
  },

  parseStreamChunk(chunk: string): CanonicalDelta | null {
    const trimmed = chunk.trim();
    if (!trimmed) return null;

    // Anthropic SSE uses "event: <type>" followed by "data: <json>"
    const lines = trimmed.split("\n");
    let eventType = "";
    let dataStr = "";

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        dataStr = line.slice(6).trim();
      }
    }

    if (!dataStr) return null;
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(dataStr);
    } catch {
      return null;
    }

    switch (eventType) {
      case "content_block_delta": {
        const delta = raw.delta as Record<string, unknown> | undefined;
        if (!delta) return null;
        if (delta.type === "text_delta") {
          return {
            choices: [{ index: 0, delta: { content: delta.text as string } }],
          };
        }
        if (delta.type === "input_json_delta") {
          return {
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: (raw.index as number) ?? 0,
                      function: { arguments: delta.partial_json as string },
                    },
                  ],
                },
              },
            ],
          };
        }
        // Unknown delta type — skip silently
        return null;
      }
      case "content_block_start": {
        const block = raw.content_block as Record<string, unknown> | undefined;
        if (block?.type === "tool_use") {
          return {
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: (raw.index as number) ?? 0,
                      id: block.id as string,
                      type: "function",
                      function: { name: block.name as string, arguments: "" },
                    },
                  ],
                },
              },
            ],
          };
        }
        return null;
      }
      case "message_delta": {
        const delta = raw.delta as Record<string, unknown> | undefined;
        const stopReason = (raw.usage as Record<string, unknown>)?.stop_reason || delta?.stop_reason;
        const finishReasonMap: Record<string, string> = {
          end_turn: "stop",
          max_tokens: "length",
          tool_use: "tool_calls",
          stop_sequence: "stop",
        };
        return {
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: (finishReasonMap[stopReason as string] as
                | "stop"
                | "length"
                | "tool_calls"
                | "content_filter"
                | null) ?? null,
            },
          ],
          usage: raw.usage
            ? {
                prompt_tokens: (raw.usage as Record<string, number>).input_tokens ?? 0,
                completion_tokens: (raw.usage as Record<string, number>).output_tokens ?? 0,
                total_tokens:
                  ((raw.usage as Record<string, number>).input_tokens ?? 0) +
                  ((raw.usage as Record<string, number>).output_tokens ?? 0),
              }
            : undefined,
        };
      }
      case "message_start": {
        return {
          id: (raw.message as Record<string, unknown>)?.id as string,
          model: (raw.message as Record<string, unknown>)?.model as string,
          choices: [{ index: 0, delta: { role: "assistant" } }],
          usage: raw.usage
            ? {
                prompt_tokens: (raw.usage as Record<string, number>).input_tokens ?? 0,
                completion_tokens: (raw.usage as Record<string, number>).output_tokens ?? 0,
                total_tokens:
                  ((raw.usage as Record<string, number>).input_tokens ?? 0) +
                  ((raw.usage as Record<string, number>).output_tokens ?? 0),
              }
            : undefined,
        };
      }
      case "ping":
        return null;
      default:
        return null;
    }
  },

  parseError(responseBody: string, statusCode: number) {
    try {
      const raw = JSON.parse(responseBody);
      return {
        httpStatus: statusCode,
        providerErrorMessage:
          raw.error?.message || raw.message || `HTTP ${statusCode}`,
        providerErrorCode: normalizeProviderErrorCode(raw.error?.type || raw.error?.code),
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
