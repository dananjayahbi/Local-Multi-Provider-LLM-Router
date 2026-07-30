// ─── Adapter Registry ───────────────────────────────────

import { ProviderAdapter } from "../canonical";
import { chatCompletionsAdapter } from "./chat-completions";
import { messagesAdapter } from "./messages";
import { responsesAdapter } from "./responses";

const adapterRegistry: Record<string, ProviderAdapter> = {
  CHAT_COMPLETIONS: chatCompletionsAdapter,
  MESSAGES: messagesAdapter,
  RESPONSES: responsesAdapter,
};

export function getAdapter(apiFormat: string): ProviderAdapter {
  const adapter = adapterRegistry[apiFormat];
  if (!adapter) {
    throw new Error(`No adapter registered for API format: ${apiFormat}`);
  }
  return adapter;
}
