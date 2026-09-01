// ─── Canonical Types ────────────────────────────────────
// Provider-agnostic internal request/response shapes used
// throughout the routing engine.

export type MessageRole = "system" | "user" | "assistant" | "tool";

export type TextContent = { type: "text"; text: string };
export type ImageContent = {
  type: "image_url";
  image_url: { url: string; detail?: "low" | "high" | "auto" };
};
export type ContentPart = TextContent | ImageContent;

export interface CanonicalMessage {
  role: MessageRole;
  content: string | ContentPart[];
  name?: string;
  tool_call_id?: string;
  // Assistant messages may carry the tool calls the model requested. Clients
  // like GitHub Copilot send these back so the next turn stays anchored to the
  // preceding `tool` results. Dropping them (as a proxy) detaches the tool
  // result from its call, confusing the model into re-issuing tools forever
  // (the "todo tool loops" symptom).
  tool_calls?: CanonicalToolCall[];
}

export interface CanonicalToolFunction {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

export interface CanonicalTool {
  type: "function";
  function: CanonicalToolFunction;
}

export interface CanonicalRequest {
  model: string;
  messages: CanonicalMessage[];
  system?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  tools?: CanonicalTool[];
  tool_choice?: "auto" | "none" | "required" | {
    type: "function";
    function: { name: string };
  };
  stop?: string | string[];
}

export interface CanonicalToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface CanonicalMessageData {
  role: "assistant";
  content: string | null;
  tool_calls?: CanonicalToolCall[];
  // Reasoning read natively by GitHub Copilot (collapsible Thinking UI).
  reasoning?: string;
  reasoning_content?: string;
}

export interface CanonicalChoice {
  index: number;
  message: CanonicalMessageData;
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
}

export interface CanonicalUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface CanonicalResponse {
  id: string;
  model: string;
  choices: CanonicalChoice[];
  usage?: CanonicalUsage;
  created: number;
}

export interface CanonicalDeltaChoice {
  index: number;
  delta: {
    role?: "assistant";
    content?: string;
    tool_calls?: Array<{
      index?: number;
      id?: string;
      type?: "function";
      function?: {
        name?: string;
        arguments?: string;
      };
    }>;
    // Reasoning fields read natively by GitHub Copilot (collapsible Thinking UI).
    reasoning?: string;
    reasoning_content?: string;
    reasoning_details?: Array<{ type?: string; text?: string; index?: number }>;
  };
  finish_reason?: "stop" | "length" | "tool_calls" | "content_filter" | null;
}

export interface CanonicalDelta {
  id?: string;
  model?: string;
  choices: CanonicalDeltaChoice[];
  usage?: CanonicalUsage;
}

// ─── Adapter Interface ──────────────────────────────────

export interface ProviderAdapter {
  buildRequest(
    canonical: CanonicalRequest,
    apiKey: string,
    baseUrl: string,
    modelId: string
  ): { url: string; headers: Record<string, string>; body: string };

  parseResponse(responseBody: string, statusCode: number): CanonicalResponse;

  parseStreamChunk(chunk: string): CanonicalDelta | null;

  parseError(
    responseBody: string,
    statusCode: number
  ): { httpStatus: number; providerErrorMessage: string; providerErrorCode: string | null };
}

/**
 * Normalize a provider error code into a string (or null). Providers often send
 * a numeric `error.code` (e.g. `404`, `429`) or an object/array `error.type`,
 * but the RequestLog `providerErrorCode` column is a `String?`. Passing a raw
 * number to Prisma throws a validation error, which the orchestrator would
 * misclassify as `UNKNOWN` and never penalize — producing a phantom "pool
 * exhausted" while every key is still healthy. Coerce any non-null value to a
 * safe string so logging always succeeds.
 */
export function normalizeProviderErrorCode(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.length > 0 ? value : null;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  try {
    const s = JSON.stringify(value);
    return s && s.length > 0 ? s : null;
  } catch {
    return String(value);
  }
}

// ─── Helpers ────────────────────────────────────────────

export function normalizeContent(content: string | ContentPart[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

export function contentToParts(content: string | ContentPart[]): ContentPart[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return content;
}
