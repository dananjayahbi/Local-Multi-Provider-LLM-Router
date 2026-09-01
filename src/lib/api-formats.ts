// ─── Provider API Format Constants ─────────────────────
// Shared across the providers page, API routes, and downstream adapters.
// Keep in sync with `src/engine/adapters/index.ts`.

export const API_FORMATS = ["CHAT_COMPLETIONS", "MESSAGES", "RESPONSES"] as const;

export type ApiFormat = (typeof API_FORMATS)[number];

/** Human-friendly label used in selectors and badges. */
export const API_FORMAT_LABELS: Record<ApiFormat, string> = {
  CHAT_COMPLETIONS: "Chat Completions (OpenAI-compatible)",
  MESSAGES: "Messages (Anthropic-style)",
  RESPONSES: "Responses (New OpenAI)",
};

export function isValidApiFormat(value: unknown): value is ApiFormat {
  return typeof value === "string" && (API_FORMATS as readonly string[]).includes(value);
}

export function apiFormatLabel(value: string): string {
  return API_FORMAT_LABELS[value as ApiFormat] ?? value;
}
