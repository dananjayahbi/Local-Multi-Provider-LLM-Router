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

export type ClientProfile = "copilot" | "universal";

export interface ClientCapabilities {
  profile: ClientProfile;
  /** Whether the client renders the `reasoning` / `reasoning_content` fields. */
  rendersReasoningFields: boolean;
  /**
   * When true, a reasoning-only delta is ALSO mirrored into `content` so a
   * client that ignores reasoning fields never sees an empty assistant turn
   * (the primary cause of the agent re-planning / looping). Reasoning fields
   * are kept, so dual-capable clients still render the Thinking UI.
   */
  bridgeReasoningToContent: boolean;
  /** Whether the Copilot-only `[ROUTER-GUIDANCE]` / `askQuestion` block may be injected. */
  supportsAskQuestionInjection: boolean;
  /**
   * When true, `tools` are NEVER stripped from a request, even for models
   * flagged `reliableToolCalls:false` — agentic clients depend on their tools.
   */
  neverStripTools: boolean;
  /**
   * When true, a machine-detectable `[ROUTER-OUTAGE]` marker is prefixed to the
   * synthetic "pool exhausted" message so an agent can distinguish a routing
   * outage from a genuine final answer.
   */
  emitOutageMarker: boolean;
  /** When true, an immediate (and periodic) no-op keepalive frame is emitted while the upstream is cold. */
  sendEarlyKeepalive: boolean;
}

/** Environment key controlling the fallback profile when no per-request override is present. */
export const CLIENT_PROFILE_ENV = "ROUTER_DEFAULT_CLIENT_PROFILE";

/** Header a client/operator may set to pin behaviour per request. */
export const CLIENT_PROFILE_HEADER = "x-router-client-profile";

const COPILOT_CAPABILITIES: ClientCapabilities = {
  profile: "copilot",
  rendersReasoningFields: true,
  bridgeReasoningToContent: false,
  supportsAskQuestionInjection: true,
  neverStripTools: false,
  emitOutageMarker: false,
  sendEarlyKeepalive: false,
};

const UNIVERSAL_CAPABILITIES: ClientCapabilities = {
  profile: "universal",
  rendersReasoningFields: false,
  bridgeReasoningToContent: true,
  supportsAskQuestionInjection: false,
  neverStripTools: true,
  emitOutageMarker: true,
  sendEarlyKeepalive: true,
};

export function capabilitiesFor(profile: ClientProfile): ClientCapabilities {
  return profile === "universal" ? { ...UNIVERSAL_CAPABILITIES } : { ...COPILOT_CAPABILITIES };
}

/** Capabilities used when no profile could be resolved — always the safe Copilot default. */
export function defaultCapabilities(): ClientCapabilities {
  return { ...COPILOT_CAPABILITIES };
}

function envDefaultProfile(): ClientProfile {
  return process.env[CLIENT_PROFILE_ENV] === "universal" ? "universal" : "copilot";
}

/** Heuristic: does this request look like it came from GitHub Copilot / VS Code? */
function looksLikeCopilot(headers: Headers): boolean {
  const ua = (headers.get("user-agent") ?? "").toLowerCase();
  return (
    headers.has("editor-version") ||
    headers.has("copilot-integration-id") ||
    headers.has("x-copilot-session-id") ||
    ua.includes("githubcopilotchat") ||
    ua.includes("copilot")
  );
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
export function resolveClientProfile(headers: Headers): ClientProfile {
  const override = headers.get(CLIENT_PROFILE_HEADER);
  if (override === "copilot" || override === "universal") return override;

  const fallback = envDefaultProfile();
  // A recognized Copilot client is pinned to the copilot profile so an operator
  // who sets the global default to `universal` cannot accidentally regress the
  // Copilot Thinking UI.
  if (looksLikeCopilot(headers)) return "copilot";
  return fallback;
}

/** Convenience: resolve the profile and return its capabilities in one step. */
export function resolveClientCapabilities(headers: Headers): ClientCapabilities {
  return capabilitiesFor(resolveClientProfile(headers));
}
