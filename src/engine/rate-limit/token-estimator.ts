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

export function estimateTokensForRateLimit(request: CanonicalRequest): number {
  const promptCharCount = estimateMessageChars(request);
  const promptTokens = Math.max(1, Math.ceil(promptCharCount / CHARS_PER_TOKEN_APPROX));

  const completionBudget =
    request.max_tokens && request.max_tokens > 0
      ? request.max_tokens
      : Math.max(MIN_COMPLETION_BUDGET, Math.min(MAX_COMPLETION_BUDGET, promptTokens));

  return promptTokens + completionBudget;
}
