"use strict";
// ─── Stream Reasoning Helpers ─────────────────────────
// Reasoning-capable models (e.g. stealth/ox-alpha, DeepSeek-R1) stream their
// chain-of-thought in `delta.reasoning` (OpenRouter, string), `delta.reasoning_content`
// (DeepSeek/Moonshot/Minimax, string) or `delta.reasoning_details` (OpenRouter,
// array of `{ text }`). GitHub Copilot natively reads these fields and renders
// a COLLAPSIBLE "Thinking" UI from them — verified in microsoft/vscode source
// `extensions/copilot/src/platform/thinking/common/thinkingUtils.ts`.
//
// Copilot's `extractThinkingDeltaFromChoice()` reads TEXT by priority:
//   cot_summary -> reasoning_text -> reasoning_content -> reasoning -> thinking
// It does NOT need reasoning inside `content`. Bridging reasoning into `content`
// (as plain `> thinking:` text) makes Copilot render it as normal answer text,
// and stripping the reasoning fields makes reasoning-only streams yield nothing
// ("no response returned").
//
// These helpers therefore: (1) normalize reasoning so Copilot sees a STRING in
// a field it reads, and (2) bridge reasoning into `content` ONLY when the
// resolved client capabilities ask for it (`bridgeReasoningToContent`). Generic
// OpenAI-compatible agents (Zoo Code, Cline, ...) ignore the `reasoning*` fields,
// so for them a reasoning-only turn MUST also appear in `content` or the turn
// looks EMPTY and the agent re-plans in a loop. Copilot keeps its collapsible
// Thinking UI untouched because the default profile never bridges.
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeReasoningDelta = normalizeReasoningDelta;
exports.isBareDelta = isBareDelta;
exports.bridgeReasoningToContent = bridgeReasoningToContent;
exports.deltaHasToolCalls = deltaHasToolCalls;
exports.resolveFinishReason = resolveFinishReason;
/**
 * Normalize a streamed delta's reasoning so Copilot reads it as a STRING in a
 * field it understands: `reasoning_content` (DeepSeek) or `reasoning`
 * (OpenRouter, after flattening `reasoning_details` array). Returns a NEW delta.
 */
function normalizeReasoningDelta(delta) {
    const newChoices = delta.choices.map((choice) => {
        var _a;
        const d = (_a = choice.delta) !== null && _a !== void 0 ? _a : {};
        const raw = d;
        const next = Object.assign({}, raw);
        // Flatten OpenRouter's array form into the string Copilot reads.
        if (Array.isArray(raw.reasoning_details)) {
            const text = raw.reasoning_details
                .map((rd) => (typeof rd.text === "string" ? rd.text : ""))
                .filter((t) => t.length > 0)
                .join("");
            if (!next.reasoning)
                next.reasoning = text;
            delete next.reasoning_details;
        }
        return Object.assign(Object.assign({}, choice), { delta: next });
    });
    return Object.assign(Object.assign({}, delta), { choices: newChoices });
}
/** Whether a delta carries no content AND no reasoning AND no tool calls. */
function isBareDelta(delta) {
    return delta.choices.every((c) => {
        var _a;
        const d = (_a = c.delta) !== null && _a !== void 0 ? _a : {};
        const raw = d;
        if (typeof d.content === "string" && d.content.length > 0)
            return false;
        if (Array.isArray(d.tool_calls) && d.tool_calls.length > 0)
            return false;
        if (typeof raw.reasoning === "string" && raw.reasoning.length > 0)
            return false;
        if (typeof raw.reasoning_content === "string" && raw.reasoning_content.length > 0)
            return false;
        return true;
    });
}
/**
 * Mirror reasoning into `content` for clients that ignore the `reasoning*`
 * fields (`bridge` flag). The reasoning fields are KEPT so a dual-capable client
 * still renders its Thinking UI. Only a reasoning-only delta is bridged — a
 * delta that already carries real `content` is left untouched so we never
 * duplicate or reorder the answer text.
 *
 * When `bridge` is false this is a strict no-op, so the Copilot path is
 * byte-for-byte unchanged.
 */
function bridgeReasoningToContent(delta, bridge) {
    if (!bridge)
        return delta;
    const choices = delta.choices.map((choice) => {
        var _a;
        const d = (_a = choice.delta) !== null && _a !== void 0 ? _a : {};
        const raw = d;
        const hasContent = typeof d.content === "string" && d.content.length > 0;
        if (hasContent)
            return choice;
        const reasoning = (typeof raw.reasoning_content === "string" && raw.reasoning_content) ||
            (typeof raw.reasoning === "string" && raw.reasoning) ||
            "";
        if (!reasoning)
            return choice;
        return Object.assign(Object.assign({}, choice), { delta: Object.assign(Object.assign({}, d), { content: reasoning }) });
    });
    return Object.assign(Object.assign({}, delta), { choices });
}
/** Finish reasons that indicate the model requested one or more tool calls. */
function deltaHasToolCalls(delta) {
    return delta.choices.some((c) => {
        var _a;
        const d = (_a = c.delta) !== null && _a !== void 0 ? _a : {};
        return Array.isArray(d.tool_calls) && d.tool_calls.length > 0;
    });
}
/**
 * Resolve the terminal `finish_reason`: if the turn actually produced tool
 * calls, it MUST be reported as `tool_calls` — otherwise an agent never
 * executes the tool and instead re-plans (a loop). Terminal intent from the
 * upstream is otherwise preserved.
 */
function resolveFinishReason(sawToolCalls, upstream) {
    if (sawToolCalls)
        return "tool_calls";
    return upstream !== null && upstream !== void 0 ? upstream : "stop";
}
