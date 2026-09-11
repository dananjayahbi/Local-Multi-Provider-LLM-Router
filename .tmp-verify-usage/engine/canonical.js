"use strict";
// ─── Canonical Types ────────────────────────────────────
// Provider-agnostic internal request/response shapes used
// throughout the routing engine.
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeProviderErrorCode = normalizeProviderErrorCode;
exports.normalizeContent = normalizeContent;
exports.contentToParts = contentToParts;
/**
 * Normalize a provider error code into a string (or null). Providers often send
 * a numeric `error.code` (e.g. `404`, `429`) or an object/array `error.type`,
 * but the RequestLog `providerErrorCode` column is a `String?`. Passing a raw
 * number to Prisma throws a validation error, which the orchestrator would
 * misclassify as `UNKNOWN` and never penalize — producing a phantom "pool
 * exhausted" while every key is still healthy. Coerce any non-null value to a
 * safe string so logging always succeeds.
 */
function normalizeProviderErrorCode(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === "string")
        return value.length > 0 ? value : null;
    if (typeof value === "number")
        return String(value);
    if (typeof value === "boolean")
        return value ? "true" : "false";
    try {
        const s = JSON.stringify(value);
        return s && s.length > 0 ? s : null;
    }
    catch (_a) {
        return String(value);
    }
}
// ─── Helpers ────────────────────────────────────────────
function normalizeContent(content) {
    if (typeof content === "string")
        return content;
    return content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
}
function contentToParts(content) {
    // Assistant tool-call turns legitimately carry `content: null`. Without this
    // guard the Anthropic/Responses adapters crashed on `.map` for exactly the
    // tool-call turn we must forward.
    if (content == null)
        return [];
    if (typeof content === "string")
        return [{ type: "text", text: content }];
    return content;
}
