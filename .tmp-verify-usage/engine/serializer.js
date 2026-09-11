"use strict";
// ─── Response Serializer ────────────────────────────────
// Converts Canonical Response / CanonicalDelta into
// OpenAI chat-completions shape for the client.
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializeResponse = serializeResponse;
exports.serializeDelta = serializeDelta;
exports.serializeStreamEnd = serializeStreamEnd;
const response_normalizer_1 = require("./response-normalizer");
const client_profile_1 = require("./clients/client-profile");
const stream_helpers_1 = require("./adapters/stream-helpers");
function serializeResponse(canonical, caps = (0, client_profile_1.defaultCapabilities)()) {
    const normalized = (0, response_normalizer_1.normalizeCanonicalResponse)(canonical);
    return {
        id: normalized.id,
        object: "chat.completion",
        created: normalized.created,
        model: normalized.model,
        choices: normalized.choices.map((choice) => ({
            index: choice.index,
            message: Object.assign(Object.assign(Object.assign({ role: choice.message.role, 
                // For clients that ignore `reasoning*`, mirror a reasoning-only turn
                // into `content` so the turn never renders empty.
                content: caps.bridgeReasoningToContent &&
                    !choice.message.content &&
                    (choice.message.reasoning_content || choice.message.reasoning)
                    ? choice.message.reasoning_content || choice.message.reasoning
                    : choice.message.content }, (choice.message.tool_calls && choice.message.tool_calls.length > 0
                ? { tool_calls: choice.message.tool_calls }
                : {})), (choice.message.reasoning ? { reasoning: choice.message.reasoning } : {})), (choice.message.reasoning_content ? { reasoning_content: choice.message.reasoning_content } : {})),
            finish_reason: choice.finish_reason,
        })),
        usage: canonical.usage
            ? {
                prompt_tokens: canonical.usage.prompt_tokens,
                completion_tokens: canonical.usage.completion_tokens,
                total_tokens: canonical.usage.total_tokens,
            }
            : undefined,
    };
}
function serializeDelta(delta, caps = (0, client_profile_1.defaultCapabilities)()) {
    // Skip deltas that carry nothing usable — pure heartbeats (no choices AND
    // no usage). A usage-only terminal chunk (empty choices[] + populated usage
    // object) MUST be forwarded so Copilot's Context Window indicator receives
    // its token counts. OpenAI sends exactly `{"choices":[],"usage":{...}}`
    // before `data: [DONE]` when `stream_options.include_usage=true`, and VS Code's
    // Copilot SSEProcessor reads `usage` independently of `choices`.
    const hasUsage = delta.usage != null;
    if ((!delta.choices || delta.choices.length === 0) && !hasUsage) {
        return "";
    }
    // Mirror reasoning into `content` for clients that ignore `reasoning*`
    // (universal profile). No-op for Copilot, so its Thinking UI is unchanged.
    const bridged = (0, stream_helpers_1.bridgeReasoningToContent)(delta, caps.bridgeReasoningToContent);
    const payload = {
        id: bridged.id || "",
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: bridged.model || "",
        choices: (bridged.choices || []).map((c) => { var _a, _b; return ({
            index: c.index,
            delta: (_a = c.delta) !== null && _a !== void 0 ? _a : {}, // some providers omit delta — ensure {} so JSON.stringify never drops it
            finish_reason: (_b = c.finish_reason) !== null && _b !== void 0 ? _b : null,
        }); }),
    };
    if (hasUsage) {
        payload.usage = delta.usage;
    }
    return `data: ${JSON.stringify(payload)}\n\n`;
}
function serializeStreamEnd() {
    return "data: [DONE]\n\n";
}
