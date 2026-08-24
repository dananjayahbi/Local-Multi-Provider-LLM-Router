import {
  ProviderAdapter,
  CanonicalRequest,
  CanonicalResponse,
  CanonicalDelta,
  contentToParts,
} from "../canonical";

function generateId(): string {
  return "resp-" + crypto.randomUUID();
}

export const responsesAdapter: ProviderAdapter = {
  buildRequest(canonical: CanonicalRequest, apiKey: string, baseUrl: string, modelId: string) {
    const url = `${baseUrl.replace(/\/+$/, "")}/responses`;

    // Build "input" array from messages
    const input: Record<string, unknown>[] = [];
    if (canonical.system) {
      input.push({ role: "system", content: canonical.system });
    }
    for (const msg of canonical.messages) {
      const entry: Record<string, unknown> = {
        role: msg.role,
        content:
          typeof msg.content === "string"
            ? msg.content
            : contentToParts(msg.content),
      };
      if (msg.name) entry.name = msg.name;
      if (msg.tool_call_id) entry.tool_call_id = msg.tool_call_id;
      // CRITICAL: forward the assistant's tool_calls so the upstream model can
      // pair them with the following `tool`-role results. Without this a tool
      // result has no anchor and the model keeps re-issuing the same tool.
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        entry.tool_calls = msg.tool_calls;
      }
      input.push(entry);
    }

    const body: Record<string, unknown> = {
      model: modelId,
      input,
      stream: canonical.stream ?? false,
    };

    if (canonical.temperature != null) body.temperature = canonical.temperature;
    if (canonical.max_tokens != null) body.max_tokens = canonical.max_tokens;
    if (canonical.top_p != null) body.top_p = canonical.top_p;
    if (canonical.tools) body.tools = canonical.tools;
    if (canonical.tool_choice) body.tool_choice = canonical.tool_choice;

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
    const output = raw.output || [];

    let textContent: string | null = "";
    const toolCalls: CanonicalResponse["choices"][0]["message"]["tool_calls"] = [];

    for (const item of output) {
      if (item.type === "message") {
        const msgContent = item.content;
        if (Array.isArray(msgContent)) {
          for (const block of msgContent) {
            if (block.type === "output_text") {
              textContent += block.text;
            }
          }
        } else if (typeof msgContent === "string") {
          textContent += msgContent;
        }
      } else if (item.type === "function_call") {
        toolCalls.push({
          id: item.call_id || item.id || "",
          type: "function",
          function: {
            name: item.name || "",
            arguments: item.arguments || "",
          },
        });
      }
    }

    const finishReasonMap: Record<string, CanonicalResponse["choices"][0]["finish_reason"]> = {
      stop: "stop",
      length: "length",
      tool_calls: "tool_calls",
      content_filter: "content_filter",
    };

    return {
      id: raw.id || generateId(),
      model: raw.model || "",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: textContent || null,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          },
          finish_reason: finishReasonMap[raw.status] || null,
        },
      ],
      usage: raw.usage
        ? {
            prompt_tokens: raw.usage.input_tokens ?? 0,
            completion_tokens: raw.usage.output_tokens ?? 0,
            total_tokens: (raw.usage.input_tokens ?? 0) + (raw.usage.output_tokens ?? 0),
          }
        : undefined,
      created: raw.created_at
        ? Math.floor(new Date(raw.created_at).getTime() / 1000)
        : Math.floor(Date.now() / 1000),
    };
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
        const event = raw.type || raw.event;

        if (event === "response.output_text.delta") {
          return {
            choices: [{ index: 0, delta: { content: raw.delta as string } }],
          };
        }
        if (event === "response.function_call_arguments.delta") {
          return {
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: (raw.output_index ?? 0) as number,
                      function: { arguments: raw.delta as string },
                    },
                  ],
                },
              },
            ],
          };
        }
        if (event === "response.function_call_arguments.done") {
          return {
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: (raw.output_index ?? 0) as number,
                      id: raw.item_id as string,
                      type: "function",
                      function: { name: raw.name as string },
                    },
                  ],
                },
              },
            ],
          };
        }
        if (event === "response.completed" || event === "response.done") {
          const resp = raw.response as Record<string, unknown> | undefined;
          return {
            id: resp?.id as string,
            model: resp?.model as string,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: resp?.status
                  ? ((resp.status as string) === "completed"
                      ? "stop"
                      : "stop") as CanonicalDelta["choices"][0]["finish_reason"]
                  : null,
              },
            ],
            usage: resp?.usage as CanonicalDelta["usage"],
          };
        }
        if (event === "response.created") {
          const resp = raw.response as Record<string, unknown> | undefined;
          return {
            id: resp?.id as string,
            model: resp?.model as string,
            choices: [{ index: 0, delta: { role: "assistant" } }],
          };
        }
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
