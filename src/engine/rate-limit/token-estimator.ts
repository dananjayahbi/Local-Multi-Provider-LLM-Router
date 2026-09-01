import { CanonicalRequest, contentToParts } from "@/engine/canonical";

const CHARS_PER_TOKEN_APPROX = 4;
const MIN_COMPLETION_BUDGET = 256;
const MAX_COMPLETION_BUDGET = 1024;

function estimateMessageChars(request: CanonicalRequest): number {
  let totalChars = request.system?.length ?? 0;

  for (const message of request.messages) {
    totalChars += message.role.length;

    if (typeof message.content === "string") {
      totalChars += message.content.length;
      continue;
    }

    const parts = contentToParts(message.content);
    for (const part of parts) {
      if (part.type === "text") {
        totalChars += part.text.length;
      } else {
        totalChars += 800;
      }
    }
  }

  if (request.tools) {
    totalChars += JSON.stringify(request.tools).length;
  }

  if (request.tool_choice) {
    totalChars += JSON.stringify(request.tool_choice).length;
  }

  if (request.stop) {
    totalChars += Array.isArray(request.stop)
      ? request.stop.join(" ").length
      : request.stop.length;
  }

  return totalChars;
}

/**
 * Estimate the PROMPT (input) tokens for a request. This is the input side
 * only — it does NOT include any completion budget so callers can separately
 * account for the output reserve (used for context-fit scoring).
 */
export function estimatePromptTokens(request: CanonicalRequest): number {
  const promptCharCount = estimateMessageChars(request);
  return Math.max(1, Math.ceil(promptCharCount / CHARS_PER_TOKEN_APPROX));
}

/**
 * Estimate the COMPLETION (output) budget to reserve for a request. Defaults
 * to the requested `max_tokens`, or a sensible cap based on the prompt size.
 * Kept separate from `estimatePromptTokens` so the two are never double-counted.
 */
export function estimateCompletionBudget(request: CanonicalRequest): number {
  const promptTokens = estimatePromptTokens(request);
  return request.max_tokens && request.max_tokens > 0
    ? request.max_tokens
    : Math.max(MIN_COMPLETION_BUDGET, Math.min(MAX_COMPLETION_BUDGET, promptTokens));
}

export function estimateTokensForRateLimit(request: CanonicalRequest): number {
  const promptTokens = estimatePromptTokens(request);
  const completionBudget = estimateCompletionBudget(request);
  return promptTokens + completionBudget;
}
