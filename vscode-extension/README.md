# LLM Router Context Compaction (VS Code Extension)

Client-side context compaction for Copilot, driven by the LLM Router gateway.

## Why this exists

The gateway **cannot** shrink the client's (Copilot's) own conversation history.
A gateway-level compact only compresses what it *forwards*, so on the very next
request Copilot re-sends its full history and the gateway compresses it *again* —
a wasteful double-compaction.

This extension fixes that by compacting **on the client**, where the history
actually lives. It gives Copilot's agent two tools:

| Tool | What it does |
|------|--------------|
| `llm-router_contextUsage` | Probes the gateway (`GET /api/gateway/v1/context`) and reports how full the conversation context is (prompt tokens, % of window). The model uses this to decide **when** to compact. |
| `llm-router_compactConversation` | Runs VS Code's native **Compact Conversation** command (`workbench.action.chat.compactAgentHostConversation`), which replaces the client-side history with a summary. The next request then genuinely sends less. |

This is the correct architecture because **a standalone MCP server cannot run the
`/compact` command** — that command only works from the extension host. A tool
registered with `vscode.lm.registerTool` runs in the extension host, so it *can*.

## Setup

1. Build the extension:
   ```sh
   cd vscode-extension
   npm install
   npx tsc -p ./
   ```

2. Configure the gateway connection in VS Code settings (`settings.json`):
   ```json
   {
     "llmRouter.gatewayBaseUrl": "http://localhost:4006",
     "llmRouter.gatewayKey": "sk-...your-gateway-key..."
   }
   ```

3. To develop/install locally, run the extension in the Extension Development Host
   (`F5` from this folder), or package it:
   ```sh
   npx @vscode/vsce package
   ```

## Architecture

```
Copilot agent
  │  calls tool
  ▼
extension host (this extension)
  ├─ contextUsage       ──►  gateway GET /api/gateway/v1/context  (read-only)
  └─ compactConversation ──►  executeCommand(workbench.action.chat.compactAgentHostConversation)
                                │
                                ▼
                          Copilot natively summarizes + replaces history
                                │
                                ▼
                          next request sends LESS context (no double-compact)
```

## Why the gateway endpoint stays

The gateway `GET /api/gateway/v1/context` route is read-only and stateless. It
exists so the model has visibility into how full the context is (real numbers,
not guesswork) and can decide whether compaction is warranted. It performs **no
summarization and rewrites nothing**.
