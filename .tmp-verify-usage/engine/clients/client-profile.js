"use strict";
// ─── Client Profile & Capabilities ──────────────────────
// This proxy was originally built around ONE client: GitHub Copilot / VS Code.
// Several behaviours that are CORRECT for Copilot are actively harmful for
// generic OpenAI-compatible agent clients (Zoo Code, Cline, Cursor, OpenAI
// SDKs): reasoning is emitted only into fields Copilot renders, a Copilot-only
// `askQuestion` guidance block is injected, tools are stripped for some models,
// and Copilot meta-tags are stripped from session fingerprints.
//
// A "client profile" selects the fidelity behaviour WITHOUT changing routing or
// key selection. The default is `copilot`, so existing behaviour is preserved
// byte-for-byte unless an operator explicitly opts into `universal`.
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLIENT_PROFILE_HEADER = exports.CLIENT_PROFILE_ENV = void 0;
exports.capabilitiesFor = capabilitiesFor;
exports.defaultCapabilities = defaultCapabilities;
exports.resolveClientProfile = resolveClientProfile;
exports.resolveClientCapabilities = resolveClientCapabilities;
/** Environment key controlling the fallback profile when no per-request override is present. */
exports.CLIENT_PROFILE_ENV = "ROUTER_DEFAULT_CLIENT_PROFILE";
/** Header a client/operator may set to pin behaviour per request. */
exports.CLIENT_PROFILE_HEADER = "x-router-client-profile";
const COPILOT_CAPABILITIES = {
    profile: "copilot",
    rendersReasoningFields: true,
    bridgeReasoningToContent: false,
    supportsAskQuestionInjection: true,
    neverStripTools: false,
    emitOutageMarker: false,
    sendEarlyKeepalive: false,
};
const UNIVERSAL_CAPABILITIES = {
    profile: "universal",
    rendersReasoningFields: false,
    bridgeReasoningToContent: true,
    supportsAskQuestionInjection: false,
    neverStripTools: true,
    emitOutageMarker: true,
    sendEarlyKeepalive: true,
};
function capabilitiesFor(profile) {
    return profile === "universal" ? Object.assign({}, UNIVERSAL_CAPABILITIES) : Object.assign({}, COPILOT_CAPABILITIES);
}
/** Capabilities used when no profile could be resolved — always the safe Copilot default. */
function defaultCapabilities() {
    return Object.assign({}, COPILOT_CAPABILITIES);
}
function envDefaultProfile() {
    return process.env[exports.CLIENT_PROFILE_ENV] === "universal" ? "universal" : "copilot";
}
/** Heuristic: does this request look like it came from GitHub Copilot / VS Code? */
function looksLikeCopilot(headers) {
    var _a;
    const ua = ((_a = headers.get("user-agent")) !== null && _a !== void 0 ? _a : "").toLowerCase();
    return (headers.has("editor-version") ||
        headers.has("copilot-integration-id") ||
        headers.has("x-copilot-session-id") ||
        ua.includes("githubcopilotchat") ||
        ua.includes("copilot"));
}
/**
 * Resolve the effective client profile. Priority (first match wins):
 *   1. Explicit per-request header `x-router-client-profile`.
 *   2. A Copilot-like client (header/UA heuristic) → always `copilot`.
 *   3. Configured default `ROUTER_DEFAULT_CLIENT_PROFILE` (default `copilot`).
 *
 * Detection NEVER keys off prompt content and never affects routing/keys — only
 * serialization/fidelity behaviour — so it is safe and reversible.
 */
function resolveClientProfile(headers) {
    const override = headers.get(exports.CLIENT_PROFILE_HEADER);
    if (override === "copilot" || override === "universal")
        return override;
    const fallback = envDefaultProfile();
    // A recognized Copilot client is pinned to the copilot profile so an operator
    // who sets the global default to `universal` cannot accidentally regress the
    // Copilot Thinking UI.
    if (looksLikeCopilot(headers))
        return "copilot";
    return fallback;
}
/** Convenience: resolve the profile and return its capabilities in one step. */
function resolveClientCapabilities(headers) {
    return capabilitiesFor(resolveClientProfile(headers));
}
