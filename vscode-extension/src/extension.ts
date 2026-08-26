// ─── LLM Router Context Compaction Extension ───────────
// Client-side context compaction for Copilot.
//
// WHY: The gateway can only compact what it forwards. It cannot shrink the
// client's (Copilot's) own conversation history, so after a gateway-level
// compact Copilot re-sends its full history and the gateway compacts it AGAIN.
// This extension moves compaction to the CLIENT: it gives the agent a tool to
// (1) probe the gateway for current context usage, and (2) run VS Code's native
// "Compact Conversation" command (`workbench.action.chat.compactAgentHostConversation`),
// which replaces the client-side history with a summary. The next request then
// genuinely sends less context, with no redundant gateway double-compaction.

import * as vscode from "vscode";

// The native VS Code command that compacts the active Copilot conversation.
// Verified against microsoft/vscode `src/vs/workbench/contrib/chat/browser/actions/chatActions.ts`.
const COMPACT_CONVERSATION_COMMAND = "workbench.action.chat.compactAgentHostConversation";

// Gateway base URL + key are read from VS Code config. Defaults match the
// local router container (port 4006).
interface RouterConfig {
  baseUrl: string;
  gatewayKey: string;
  defaultModel?: string;
}

function getRouterConfig(): RouterConfig {
  const cfg = vscode.workspace.getConfiguration("llmRouter");
  return {
    baseUrl: cfg.get<string>("gatewayBaseUrl", "http://localhost:4006"),
    gatewayKey: cfg.get<string>("gatewayKey", ""),
    defaultModel: cfg.get<string>("defaultModel", ""),
  };
}

/**
 * Probe the gateway for current context usage of a session/model.
 * Returns a human-readable status the model can use to decide whether to compact.
 */
async function queryContextUsage(model?: string): Promise<string> {
  const { baseUrl, gatewayKey, defaultModel } = getRouterConfig();
  if (!gatewayKey) {
    return "⚠️ LLM Router gateway key not configured. Set `llmRouter.gatewayKey` in settings.";
  }

  // Prefer the caller-supplied model, else the configured default, else none.
  const targetModel = model || defaultModel || undefined;

  const url = new URL(`${baseUrl}/api/gateway/v1/context`);
  if (targetModel) url.searchParams.set("model", targetModel);

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${gatewayKey}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    return `⚠️ Gateway context probe failed (HTTP ${res.status}).`;
  }

  const data = (await res.json()) as {
    model?: string | null;
    contextWindow?: number | null;
    promptTokens?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
    pctUsed?: number | null;
    updatedAt?: string | null;
    recentRequests?: number;
  };

  const pct = data.pctUsed != null ? `${data.pctUsed}%` : "unknown";
  const window = data.contextWindow ? data.contextWindow.toLocaleString() : "unknown";
  const prompt = data.promptTokens != null ? data.promptTokens.toLocaleString() : "unknown";
  const total = data.totalTokens != null ? data.totalTokens.toLocaleString() : "unknown";

  let advice = "";
  if (data.pctUsed == null) {
    advice = "No usage data yet for this session.";
  } else if (data.pctUsed >= 80) {
    advice = "Context is nearly full. Strongly recommend compacting now.";
  } else if (data.pctUsed >= 60) {
    advice = "Context usage is elevated. Consider compacting soon.";
  } else {
    advice = "Context usage is healthy. No compaction needed yet.";
  }

  return [
    `LLM Router context usage:`,
    `- Model: ${data.model ?? targetModel ?? "unknown"}`,
    `- Prompt tokens: ${prompt} / ${window} (${pct})`,
    `- Total tokens: ${total}`,
    `- Last updated: ${data.updatedAt ?? "never"}`,
    `- Recent requests: ${data.recentRequests ?? 0}`,
    advice,
  ].join("\n");
}

/**
 * Run VS Code's native "Compact Conversation" command.
 * This is the CLIENT-side compaction: it replaces the chat history with a
 * summary so the next request sends less. It cannot be done from a standalone
 * MCP server (that runs outside the extension host).
 */
async function compactConversation(reason?: string): Promise<string> {
  const hasCommand = await vscode.commands.getCommands(true).then((cmds) =>
    cmds.includes(COMPACT_CONVERSATION_COMMAND)
  );
  if (!hasCommand) {
    return "⚠️ The Compact Conversation command is not available in this VS Code version.";
  }

  const note = reason?.trim() ? ` Reason: ${reason.trim()}` : "";
  const executed = await vscode.commands.executeCommand(COMPACT_CONVERSATION_COMMAND);

  if (executed === undefined || executed === false) {
    // The command may still have succeeded asynchronously; treat an undefined
    // result as "likely succeeded" rather than an error.
    return `✅ Compact Conversation command invoked.${note}`;
  }
  return `✅ Compact Conversation command invoked.${note}`;
}

export function activate(context: vscode.ExtensionContext) {
  // Register the context-usage tool.
  const usageTool: vscode.LanguageModelTool<{ model?: string }> = {
    async invoke(options, _token) {
      const input = options.input ?? {};
      const text = await queryContextUsage(input.model);
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
    },
  };
  context.subscriptions.push(
    vscode.lm.registerTool("llm-router_contextUsage", usageTool)
  );

  // Register the compact-conversation tool.
  const compactTool: vscode.LanguageModelTool<{ reason?: string }> = {
    async invoke(options, _token) {
      const input = options.input ?? {};
      const text = await compactConversation(input.reason);
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
    },
  };
  context.subscriptions.push(
    vscode.lm.registerTool("llm-router_compactConversation", compactTool)
  );

  // A manual command too, so users (and keybindings) can compact directly.
  context.subscriptions.push(
    vscode.commands.registerCommand("llmRouter.compactConversation", async () => {
      const result = await compactConversation();
      void vscode.window.showInformationMessage(result);
    })
  );
}

export function deactivate() {}
