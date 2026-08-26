// ─── Session Identifier Resolver ───────────────────────
// Derives a STABLE identity for a Copilot / BYOK chat session so the gateway
// can route each session to its OWN key and keep it pinned across turns.
//
// VS Code's `customendpoint` provider does NOT send a guaranteed session
// header. So we resolve a best-effort id from a priority list of headers and
// body fields, then fall back to a content fingerprint of the conversation.
//
// STABILITY IS THE WHOLE POINT. A session id that changes between turns makes
// the key-lock registry think a NEW session arrived each time, so it re-routes
// to a different key and breaks the provider's prompt-cache discount. Two
// traps cause exactly that:
//   - `x-request-id` is PER-REQUEST (a fresh id every call), never a session
//     id. Using it as a session key makes every turn look like a new session.
//   - A fingerprint that includes message COUNT or tool presence changes the
//     moment the conversation grows or a tool is attached (e.g. you assign a
//     task). A stable fingerprint must key ONLY on text that identifies the
//     conversation and never changes as it grows.

// Length cap so a malformed/huge header can't bloat the lock registry key.
export const MAX_SESSION_ID_LENGTH = 128;

// TRUSTED per-conversation session headers, tried in order.
// VERIFIED (live traffic, GitHubCopilotChat/0.62.0): `x-interaction-id` is
// SHARED by every chat window in one VS Code editor session (NOT per-conversation),
// so it must NOT be used as the key — using it collapses all windows onto one
// key. `x-request-id` / `x-agent-task-id` are PER-REQUEST and are ignored too.
// These trusted headers are sent by OTHER OpenAI-compatible clients; VS Code
// Copilot sends none of them, so for VS Code the resolver returns null and the
// router falls back to its pool-scoped caching-aware selector (which spreads
// parallel load and sticks one conversation via conv affinity).
const TRUSTED_SESSION_HEADERS = [
  "x-copilot-session-id",
  "x-session-id",
  "x-conversation-id",
  "x-chat-session-id",
  "openai-conversation-id", // Copilot SDK may send this on the auth header
] as const;



/** Body fields, tried after headers (OpenAI-compatible clients often send one). */
const SESSION_BODY_FIELDS = ["session_id", "conversation_id", "sessionId", "thread_id"] as const;

/**
 * A request wrapper that abstracts over the NextRequest headers + JSON body so
 * this pure resolver can be unit-tested without an HTTP server.
 */
export interface SessionRequestLike {
  headers: Record<string, string | string[] | undefined> | Headers;
  body?: Record<string, unknown> | null;
  /** Messages array pushed by the caller (usually `body.messages`). */
  messages?: Array<{ role?: string; content?: unknown }>;
}

function headerValue(
  h: SessionRequestLike["headers"],
  name: string
): string | null {
  if (h instanceof Headers) {
    return h.get(name);
  }
  const raw = h[name.toLowerCase()] ?? h[name];
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw ?? null;
}

/**
 * Text content of a single message, flattened (string or array-of-parts).
 */
function messageText(m: { role?: string; content?: unknown }): string {
  const content = m?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === "string" ? p : (p as { text?: string })?.text ?? ""))
      .join(" ");
  }
  return "";
}

// Roles that carry a SHARED/system-wide prompt and must NEVER be used as a
// per-conversation anchor — they are identical across all sessions, so using
// them would make every conversation collide on the same id (the "all sessions
// share one key" regression).
const NON_ANCHOR_ROLES = new Set(["system", "developer", "tool", "function"]);

// The set of XML tags Copilot injects as a (byte-identical) shared context
// block at the front of EVERY chat window. These carry NO per-conversation
// identity: `<environment_info>`, `<workspace_info>`, `<attachments>`, etc.
// We strip these blocks from user text and anchor on what REMAINS — the REAL
// prompt, which Copilot appends AFTER the meta block.
const META_TAG_NAMES = new Set([
  "environment_info",
  "environment",
  "workspace_info",
  "workspace",
  "attachments",
  "attachment",
  "context",
  "selection",
  "system",
  "user",
  "tool",
  "tools",
  "session",
  "conversation",
  "instructions",
  "prompt",
  "global",
  "meta",
  "repo",
  "repository",
  "file",
  "files",
  "thread",
  "conversation_info",
]);

/**
 * Remove Copilot's injected META/ENVIRONMENT/CONTEXT XML blocks from a user
 * message, leaving the genuine per-conversation prompt text behind.
 *
 * Copilot prepends an IDENTICAL block as the first user turn in EVERY chat
 * window: `<environment_info>`, `<workspace_info>`, `<attachments>`, plus the
 * "these are the tools..." preamble. The REAL user task is appended AFTER that
 * block (verified live from GitHubCopilotChat/0.62.0 traffic). If we treated
 * the whole block-as-one as the anchor, every window would hash to the same id.
 * Stripping the meta blocks and anchoring on the remainder separates windows.
 *
 * Only tags in META_TAG_NAMES are stripped — a prompt that legitimately wraps
 * prose in NON-meta markup is preserved.
 */
function stripCopilotMetaBlocks(text: string): string {
  if (!text) return text;
  const names = [...META_TAG_NAMES].join("|");
  // Pass 1: remove well-formed <tag>...</tag> pairs (non-greedy).
  const pairRe = new RegExp(`<(${names})\\b[^>]*>[\\s\\S]*?<\\/\\1>|<(${names})\\b[^>]*\\/>`, "gi");
  let out = text.replace(pairRe, " ");
  // Pass 2: remove any ORPHAN meta open/close tags left behind by malformed
  // nesting — Copilot closes an inner <attachment> with </attachments>, so a
  // strict </\1> pairing leaves stray tags that pollute the anchor.
  out = out.replace(new RegExp(`<\\s*\\/(${names})\\s*>`, "gi"), " ");
  out = out.replace(new RegExp(`<(${names})\\b[^>]*>`, "gi"), " ");
  // Drop the "these are the tools..." preamble (plain text, not XML).
  out = out.replace(/these are the tools and functions available to you[\s\S]*?(?=\n\n|$)/i, " ");
  return out;
}

/**
 * Whether a user message is ONLY Copilot's injected meta block (no real prompt
 * appended). Copilot prepends an IDENTICAL block as the first user turn in
 * EVERY chat window. Verified meta markers (live dumps): `<environment_info>`,
 * `<attachments>`, `<context>`, plus the "these are the tools..." preamble.
 * Such a block is byte-for-byte the same across sessions, so using it as an
 * anchor would make every window hash to the same id. We strip it (see
 * stripCopilotMetaBlocks) and anchor on the REAL task text instead.
 */
function isCopilotMetaUserText(text: string): boolean {
  const lower = text.slice(0, 600).toLowerCase();
  // Any leading XML-like meta tag Copilot injects ("<environment_info>",
  // "<attachments>", "<context>", "<workspace>", "<selection>", etc.).
  const leadingTag = lower.match(/^<\s*([a-z][a-z0-9_-]*)/);
  if (leadingTag) {
    const tag = leadingTag[1];
    if (META_TAG_NAMES.has(tag)) {
      return true;
    }
  }
  return (
    lower.startsWith("<environment_info") ||
    lower.startsWith("<attachments") ||
    lower.startsWith("<workspace_info") ||
    lower.startsWith("<context") ||
    lower.includes("system-operating system") ||
    (lower.includes("windows") && lower.includes("environment_info")) ||
    lower.includes("these are the tools and functions available to you")
  );
}

/**
 * Extract a stable per-conversation text anchor. We key on the text content of
 * the FIRST genuine user task — it identifies the conversation and never
 * changes as the thread grows. Adding further messages or attaching tools does
 * NOT change it, so turns within one conversation always resolve to the same
 * id.
 *
 * We deliberately skip:
 *   - system/developer/tool/function messages (shared boilerplate), and
 *   - Copilot's injected `<environment_info>` context block (the first user
 *     turn is usually an IDENTICAL environment dump in every window).
 * A session anchor must be genuine per-conversation user input, or different
 * sessions will hash to the same id (the "all sessions share one key" bug).
 */
function firstUserText(
  messages?: SessionRequestLike["messages"]
): string {
  const msgs = Array.isArray(messages) ? messages : null;
  if (!msgs?.length) return "";

  // Scanner: first message whose role is a real user turn whose content is
  // non-empty AND is not Copilot's shared environment/meta block. When Copilot
  // appends the real prompt AFTER the meta block, we strip the meta block and
  // anchor on what remains.
  for (const m of msgs) {
    const role = (m?.role || "").toLowerCase();
    if (NON_ANCHOR_ROLES.has(role)) continue;
    const raw = messageText(m).trim();
    if (raw.length === 0) continue;
    if (isCopilotMetaUserText(raw)) {
      // Strip the shared meta blocks; the remaining text is the real prompt.
      const stripped = stripCopilotMetaBlocks(raw).trim();
      if (stripped.length > 0) return stripped;
      continue; // pure meta block with no real prompt — skip
    }
    return raw;
  }

  // No usable per-conversation user text at all (rare for a real chat).
  return "";
}

/**
 * Fingerprint a conversation's identity from a STABLE anchor. Uses the first
 * user message text (never the message count or tool presence) so the id does
 * not drift as the conversation grows or tools are attached.
 */
function contentFingerprint(
  messages?: SessionRequestLike["messages"]
): string | null {
  const text = firstUserText(messages);
  if (text.length === 0) return null;

  // Anchor on the first user text only. Do NOT include msgs.length or tools —
  // both change across turns and would rotate the session key (the bug).
  const seed = text.slice(0, 2000);
  // FNV-1a 32-bit hash → compact, deterministic, hex.
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const fp = `fp:${(hash >>> 0).toString(16).padStart(8, "0")}`;
  if (debugEnabled()) {
    // Show a short anchor preview so collisions from a shared system prompt
    // (the "all sessions one key" bug) are immediately visible.
    console.error(`[session-id] fingerprint anchor: "${seed.slice(0, 60)}" → ${fp}`);
  }
  return fp;
}

/** When true, log the resolved session id at each gateway request. */
function debugEnabled(): boolean {
  return process.env.SESSION_ID_DEBUG === "1" || process.env.SESSION_ID_DEBUG === "true";
}

/**
 * Resolve a stable session id from a request. Returns null only when NO signal
 * exists at all (should be rare); callers treat null as a shared "default"
 * session, keeping the legacy single-session behavior as a safe fallback.
 */
/** Log every header name, the relevant body fields, and the message-role
 *  sequence so we can see EXACTLY what signals a real VS Code request carries.
 *  Diagnostics only; enabled by SESSION_ID_DEBUG=1. */
function dumpSignals(req: SessionRequestLike): void {
  const headers: Record<string, string> = {};
  const h = req.headers;
  if (h instanceof Headers) {
    for (const k of h.keys()) headers[k] = h.get(k) ?? "";
  } else {
    for (const k of Object.keys(h)) headers[k] = String(h[k] ?? "");
  }
  const roles = (Array.isArray(req.messages) ? req.messages : [])
    .map((m) => (m?.role ?? "?").toString().slice(0, 10));
  // Show the first ~60 chars of EACH user message so we can see the real task
  // vs Copilot's injected meta block (which is what the resolver skips). This
  // is the ground truth for why two windows collide.
  const userSnippets = (Array.isArray(req.messages) ? req.messages : [])
    .filter((m) => (m?.role ?? "").toLowerCase() === "user")
    .map((m) => `"${messageText(m).trim().slice(0, 60)}"`);
  const bodyFields: Record<string, string> = {};
  if (req.body) {
    for (const f of SESSION_BODY_FIELDS) {
      const v = req.body[f];
      bodyFields[f] = typeof v === "string" ? v : typeof v === "number" ? String(v) : "∅";
    }
  }
  // FULL raw message content (bounded) — the ground truth for what
  // distinguishes two parallel windows. Show BOTH the head (first 300 chars —
  // the injected meta block) AND the tail (last 400 chars — where the REAL
  // user prompt lives, after the `<attachments>`/`<environment_info>` blocks).
  const fullMsgs = (Array.isArray(req.messages) ? req.messages : [])
    .map((m) => {
      const c = messageText(m);
      if (c.length <= 700) return `${m?.role ?? "?"}::${c}`;
      return `${m?.role ?? "?"}::[...${c.length}chars] HEAD=${JSON.stringify(c.slice(0, 300))} TAIL=${JSON.stringify(c.slice(-400))}`;
    });
  const lastUserTail = (() => {
    const users = (Array.isArray(req.messages) ? req.messages : []).filter(
      (m) => (m?.role ?? "").toLowerCase() === "user"
    );
    const last = users[users.length - 1];
    return last ? messageText(last).slice(-500) : "";
  })();
  console.error(
    `[session-id:dump] headers=${JSON.stringify(headers)} bodyFields=${JSON.stringify(bodyFields)} ` +
      `roles=[${roles.join(",")}] msgCount=${Array.isArray(req.messages) ? req.messages.length : 0} ` +
      `userMsgs=${JSON.stringify(userSnippets)} lastUserTail=${JSON.stringify(lastUserTail)} ` +
      `fullContent=${JSON.stringify(fullMsgs)}`
  );
}

/**
 * Resolve a stable **per-conversation** session id from a request — used only
 * when the client carries a GENUINE per-conversation identifier.
 *
 * For VS Code Copilot there is none: `x-interaction-id` is shared across all
 * chat windows in one editor session, `x-request-id`/`x-agent-task-id` are
 * per-request, the body has no session field, and identical parallel prompts
 * produce byte-identical message content. So we deliberately return **null**
 * for such requests, letting the router fall back to its pool-scoped
 * caching-aware selector — which spreads parallel load across keys and keeps
 * one conversation sticky via conv affinity. (Trying to force a session id
 * here is what collapsed two parallel windows onto one key.)
 *
 * Non-VS-Code clients that send a genuine session/conversation id in a header
 * or body field are honored.
 *
 * Returns null when there is no reliable per-conversation signal; callers
 * treat null as a shared "default" session (legacy single-session fallback).
 */
export function resolveSessionId(req: SessionRequestLike): string | null {
  if (debugEnabled()) {
    dumpSignals(req);
  }

  // 0) A TRUSTED per-conversation session HEADER (e.g. x-interaction-id for
  //    VS Code Copilot). Verified live: distinct per chat window, stable per
  //    conversation. `x-request-id` / `x-agent-task-id` are NOT in this list
  //    (per-request). Some clients also send x-session-id / x-conversation-id.
  for (const name of TRUSTED_SESSION_HEADERS) {
    const v = headerValue(req.headers, name);
    if (v && v.trim()) {
      const id = normalize(v);
      if (debugEnabled()) {
        console.error(`[session-id] resolved from trusted header ${name}: ${id}`);
      }
      return id;
    }
  }

  // 1) A genuine per-conversation BODY field (e.g. session_id / conversation_id).
  //    Genuinely per-conversation, unlike x-request-id (per-request). If
  //    present, use it directly.
  const bodyField = findSessionBodyField(req.body);
  if (bodyField) {
    if (debugEnabled()) {
      console.error(`[session-id] resolved from body field: ${bodyField}`);
    }
    return bodyField;
  }

  // 2) Content fingerprint fallback (no session header/body field at all).
  //    Must NOT include message count, tool presence, or Copilot's shared
  //    <environment_info> / <attachments> meta blocks — only the genuine user
  //    task text, so different conversations stay distinct.
  const fp = contentFingerprint(req.messages);
  if (fp) {
    if (debugEnabled()) {
      console.error(
        `[session-id] resolved content-first: anchor "${anchorPreview(req.messages)}" → ${fp}`
      );
    }
    return fp;
  }

  if (debugEnabled()) {
    console.error("[session-id] NO SIGNAL → returns null (pool-scoped fallback → shared key)");
  }
  return null;
}

/** A genuine per-conversation session id in the request body, if any. */
function findSessionBodyField(body?: SessionRequestLike["body"]): string | null {
  if (!body) return null;
  for (const field of SESSION_BODY_FIELDS) {
    const v = body[field];
    const id =
      typeof v === "string" && v.trim()
        ? normalize(v)
        : typeof v === "number"
          ? normalize(String(v))
          : null;
    if (id) return id;
  }
  return null;
}

/** A short preview of the anchor used for the fingerprint, for debugging. */
function anchorPreview(messages?: SessionRequestLike["messages"]): string {
  return firstUserText(messages).slice(0, 60);
}

/** Normalize + cap the resolved id so the lock registry key stays sane. */
export function normalize(id: string): string {
  const trimmed = id.trim();
  if (trimmed.length <= MAX_SESSION_ID_LENGTH) return trimmed;
  return trimmed.slice(0, MAX_SESSION_ID_LENGTH) + ":" + hashSuffix(trimmed);
}

function hashSuffix(s: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
