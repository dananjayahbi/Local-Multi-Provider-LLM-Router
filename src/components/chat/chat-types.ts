// ─── Chat Page Types ───────────────────────────────────

export interface ChatModel {
  id: string;
  modelId: string;
  displayName: string;
  supportsVision: boolean;
  contextWindow: number | null;
  provider: { id: string; name: string; apiFormat: string };
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  error?: string;
}

export interface ChatTurn {
  messages: ChatMessage[];
}
