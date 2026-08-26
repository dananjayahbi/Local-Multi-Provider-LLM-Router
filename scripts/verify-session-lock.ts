// ─── Session Lock Regression Test ──────────────────────
// Validates the multi-session key-locking logic:
//  1. resolveSessionId picks explicit headers > body fields > content hash.
//  2. acquireSessionLock picks a free best key; a second session skips it.
//  3. A session stays pinned to its own key across turns.
//  4. releaseSessionLockForKey frees the key on penalty.
//  5. isKeyLockedByOtherSession reflects cross-session exclusion.
//  6. Stale locks are swept by countStaleLocks / act of acquisition.
//
// Run: npx --yes tsx scripts/verify-session-lock.ts

import { resolveSessionId } from "../src/engine/routing/session-id";
import {
  acquireSessionLock,
  getSessionLockedKey,
  releaseSessionLock,
  releaseSessionLockForKey,
  isKeyLockedByOtherSession,
  clearAllLocks,
  countStaleLocks,
  countLocks,
  DEFAULT_SESSION_LOCK_TTL_MS,
} from "../src/engine/routing/session-lock";
import type { RouteCandidate } from "../src/engine/routing/selector";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

function key(id: string, status = "ACTIVE"): RouteCandidate {
  return {
    apiKeyId: id,
    apiKeyLabel: `key-${id}`,
    secret: "sk-test",
    secretEncrypted: null,
    status,
    penaltyLevel: 0,
    penaltyExpiresAt: null,
    lastUsedAt: null,
    rpmLimit: null,
    tpmLimit: null,
    rpdLimit: null,
    tpdLimit: null,
    tps: null,
    timeToFirstTokenMs: null,
    contextWindow: null,
    cacheCapable: true,
    cacheDiscountFactor: 0.1,
  };
}

// ─── 1. Session ID resolution ──────────────────────────
console.log("\n[1] resolveSessionId");
{
  const header = resolveSessionId({
    headers: { "x-copilot-session-id": "sess-abc-123", "x-request-id": "req-999" },
    body: {},
  });
  assert(header === "sess-abc-123", "explicit x-copilot-session-id header wins");

  const header2 = resolveSessionId({
    headers: { "x-session-id": "sess-xyz", "x-request-id": "req-1" },
    body: {},
  });
  assert(header2 === "sess-xyz", "x-session-id header used when no copilot header");

  const bodyField = resolveSessionId({
    headers: {},
    body: { session_id: "body-sess-1", tools: [{ type: "function" }] },
    messages: [{ role: "user", content: "hi" }],
  });
  assert(bodyField === "body-sess-1", "session_id body field used when no headers");

  const contentHash = resolveSessionId({
    headers: {},
    body: { tools: [] },
    messages: [{ role: "user", content: "Hello copilot, write a test" }],
  });
  assert(contentHash !== null && contentHash.startsWith("fp:"), "content hash fallback (fp:)");

  const contentSame = resolveSessionId({
    headers: {},
    body: { tools: [] },
    messages: [{ role: "user", content: "Hello copilot, write a test" }],
  });
  assert(contentHash === contentSame, "content hash is stable for same conversation");

  const contentDiff = resolveSessionId({
    headers: {},
    body: { tools: [] },
    messages: [{ role: "user", content: "A totally different prompt here" }],
  });
  assert(contentHash !== contentDiff, "different conversation → different hash");

  const nullSession = resolveSessionId({ headers: {}, body: {}, messages: [] });
  assert(nullSession === null, "no signal at all → null");

  // ── STABILITY: the id must NOT change as the conversation grows ──
  // Turn 2 has MORE messages + tools attached (e.g. a task assigned). This
  // must resolve to the SAME session id so the key stays pinned.
  const turn1 = resolveSessionId({
    headers: {},
    body: { tools: [] },
    messages: [{ role: "user", content: "Write a test for the router" }],
  });
  const turn2Grown = resolveSessionId({
    headers: {},
    body: { tools: [{ type: "function" }] }, // tools now present
    messages: [
      { role: "user", content: "Write a test for the router" },
      { role: "assistant", content: "Sure, here's the plan." },
      { role: "user", content: "Now actually implement it and run it." },
    ],
  });
  assert(turn1 === turn2Grown, "hash stable when conversation grows + tools attach");

  const differentPrompt = resolveSessionId({
    headers: {},
    body: { tools: [] },
    messages: [{ role: "user", content: "Completely unrelated task" }],
  });
  assert(turn1 !== differentPrompt, "different first-user anchor → different session");

  // ── COLLISION SAFETY: shared system/developer prompts must NOT collide ──
  // Two DIFFERENT conversations that share the same system prompt (typical for
  // Copilot) plus a generated assistant reply must resolve to distinct ids —
  // they must differ by their genuine user anchor, not collapse to the system
  // text. This is the exact regression that made "all sessions share one key".
  const sysPrompt = "You are a helpful code assistant.";
  const sA = resolveSessionId({
    headers: {},
    body: { tools: [] },
    messages: [
      { role: "system", content: sysPrompt },
      { role: "user", content: "Explain the ORCHESTRATOR module" },
    ],
  });
  const sB = resolveSessionId({
    headers: {},
    body: { tools: [] },
    messages: [
      { role: "system", content: sysPrompt },
      { role: "user", content: "Explain the RATE LIMITER module" },
    ],
  });
  assert(sA !== null, "session with shared system prompt still resolves");
  assert(sA !== sB, "two sessions tied to same system prompt do NOT collide");

  // A message list with ONLY a system prompt (no user anchor) must NOT produce
  // a usable fingerprint — otherwise every brand-new session collides.
  const onlySystem = resolveSessionId({
    headers: {},
    body: {},
    messages: [{ role: "system", content: sysPrompt }],
  });
  assert(onlySystem === null, "system-only message list yields no anchor (no false session)");

  // ── x-request-id / x-agent-task-id are PER-REQUEST, must NOT be session ids ──
  const req1 = resolveSessionId({
    headers: { "x-request-id": "req-111", "x-session-id": "sess-A" },
    body: {},
    messages: [{ role: "user", content: "hello" }],
  });
  const req2 = resolveSessionId({
    headers: { "x-request-id": "req-222", "x-session-id": "sess-A" },
    body: {},
    messages: [{ role: "user", content: "hello" }],
  });
  assert(req1 === req2, "same session id across different x-request-id values (content-first)");

  // ── VS Code Copilot: shared x-interaction-id + identical meta content → null ──
  // VERIFIED live: x-interaction-id is SHARED across windows and the two
  // windows send BYTE-IDENTICAL content (same <environment_info>, same
  // <workspace_info>, same <attachments>, same task). There is NO per-
  // conversation signal, so resolveSessionId must return null and let the
  // pool-scoped caching-aware selector spread load (the original behavior).
  const envBlock = "<environment_info>\nOperating System: Windows\nThese are the tools and functions available to you.\n</environment_info>";
  const vscodeReq = {
    headers: {
      "x-interaction-id": "shared-session-1",
      "x-agent-task-id": "task-1",
      "x-request-id": "req-1",
    },
    body: {},
    messages: [
      { role: "system", content: sysPrompt },
      { role: "user", content: envBlock },
      {
        role: "user",
        content:
          "<workspace_info>\nI am working in a workspace with the following folders:\n- e:\\work_git_repos\\pos-lite\n</workspace_info>\n<attachments>\n<attachment id=\"dananjayahbi/pos-lite\">\nRepository name: pos-lite\n</attachments>",
      },
    ],
  };
  const vsCodeA = resolveSessionId(vscodeReq);
  // A byte-identical second window (same task, same everything).
  const vsCodeB = resolveSessionId({ ...vscodeReq, headers: { ...vscodeReq.headers, "x-agent-task-id": "task-9", "x-request-id": "req-9" } });
  assert(vsCodeA === null, "VS Code Copilot (shared x-interaction-id + meta-only content) → null");
  assert(vsCodeB === null, "second identical window also → null (no false session)");
  assert(
    vsCodeA === vsCodeB,
    "identical parallel windows are indistinguishable → both null (selector decides)"
  );

  // ── Copilot meta blocks are skipped; only a REAL task yields an id ──
  // Byte-identical meta-only content (no real task) => null so the selector
  // spreads load. This is correct: two identical parallel windows are
  // indistinguishable at the request level.
  assert(
    vsCodeA === null && vsCodeB === null,
    "meta-only identical content yields null (selector decides, no forced colliding id)"
  );

  // Offline-augmented Copilot now injects <attachments> as the FIRST user turn
  // (identical across windows) — it must be skipped too, and the REAL task
  // (the SECOND user message) must be the anchor.
  const attachmentsBlock = "<attachments>\n- file.ts\n- dir/\n</attachments>";
  const withAttachmentsA = resolveSessionId({
    headers: {},
    body: {},
    messages: [
      { role: "system", content: sysPrompt },
      { role: "user", content: attachmentsBlock },
      { role: "user", content: "Refactor the orchestrator" },
    ],
  });
  const withAttachmentsB = resolveSessionId({
    headers: {},
    body: {},
    messages: [
      { role: "system", content: sysPrompt },
      { role: "user", content: attachmentsBlock },
      { role: "user", content: "Fix the rate limiter" },
    ],
  });
  assert(withAttachmentsA !== null, "session with <attachments> meta still resolves");
  assert(
    withAttachmentsA !== withAttachmentsB,
    "shared <attachments> block does NOT make sessions collide when tasks differ"
  );
  // Same window across turns: <attachments> block is re-sent but the task stays.
  const withAttachmentsA2 = resolveSessionId({
    headers: {},
    body: {},
    messages: [
      { role: "system", content: sysPrompt },
      { role: "user", content: attachmentsBlock },
      { role: "user", content: "Refactor the orchestrator" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "now also do X" },
    ],
  });
  assert(
    withAttachmentsA === withAttachmentsA2,
    "same window (re-sent <attachments>) → id stable"
  );

  // An anchor that is ONLY a meta tag (no real task) must NOT produce an id.
  const onlyMeta = resolveSessionId({
    headers: {},
    body: {},
    messages: [{ role: "system", content: sysPrompt }, { role: "user", content: attachmentsBlock }],
  });
  assert(onlyMeta === null, "only-meta message list yields no anchor (no false session)");
}

// ─── 2. Acquire + cross-session exclusion ──────────────
console.log("\n[2] acquireSessionLock + exclusion");
clearAllLocks();
{
  const candidates = [key("k1"), key("k2"), key("k3")];
  const s1 = acquireSessionLock("S1", "pool1", candidates);
  assert(s1 !== null, "S1 acquires a key");
  assert(s1!.keyId === "k1", "S1 gets the best (first) free key k1");
  assert(countLocks() === 1, "one lock after S1 acquire");

  const s2 = acquireSessionLock("S2", "pool1", candidates);
  assert(s2 !== null, "S2 acquires a key too");
  assert(s2!.keyId !== "k1", "S2 does NOT get k1 (held by S1)");
  assert(s2!.keyId === "k2", "S2 gets the next free key k2");

  assert(isKeyLockedByOtherSession("S1", "pool1", "k1") === false, "S1 sees its own key as free");
  assert(isKeyLockedByOtherSession("S2", "pool1", "k1") === true, "S2 sees k1 as locked by other");
  assert(countLocks() === 2, "two distinct locks, keys stay separate");
}

// ─── 3. Session stays pinned to its own key ────────────
console.log("\n[3] stickiness across turns");
clearAllLocks();
{
  const candidates = [key("k1"), key("k2")];
  acquireSessionLock("S1", "pool2", candidates);
  const held = getSessionLockedKey("S1", "pool2");
  assert(held !== null, "S1 holds a key");
  // Re-acquire with only the held key present → stays on the same key.
  const reacquire = acquireSessionLock("S1", "pool2", [key(held!.keyId)]);
  assert(reacquire!.keyId === held!.keyId, "S1 re-acquires the SAME key (no rotation)");
  assert(countLocks() === 1, "still only one lock for S1");

  // Turn-2 scenario: the session re-acquires with a FULL pool again (two keys)
  // and must STILL keep its original key, not rotate to the other free one.
  const reacquireFull = acquireSessionLock("S1", "pool2", [key("k1"), key("k2")]);
  assert(
    reacquireFull!.keyId === held!.keyId,
    "S1 keeps its key after re-acquiring against the full pool (no rotation on turn 2)"
  );
  assert(countLocks() === 1, "still only one lock for S1 after re-acquire");
}

// ─── 4. Penalty-driven release ─────────────────────────
console.log("\n[4] releaseSessionLockForKey on penalty");
clearAllLocks();
{
  const candidates = [key("k1"), key("k2")];
  acquireSessionLock("S1", "pool3", candidates);
  acquireSessionLock("S2", "pool3", candidates);
  const released = releaseSessionLockForKey("pool3", "k1");
  assert(released === 1, "released exactly one lock for k1");
  assert(isKeyLockedByOtherSession("S1", "pool3", "k1") === false, "k1 free again after penalty");

  // A different session can now take k1.
  const s3 = acquireSessionLock("S3", "pool3", candidates);
  assert(s3 !== null, "S3 can acquire after release");
}

// ─── 5. Explicit session release ───────────────────────
console.log("\n[5] releaseSessionLock (session-scoped)");
clearAllLocks();
{
  acquireSessionLock("S1", "pool4", [key("k1")]);
  const ok = releaseSessionLock("S1", "pool4", "k1");
  assert(ok === true, "releasing the exact held key works");
  assert(countLocks() === 0, "no locks remain after release");

  acquireSessionLock("S1", "pool4", [key("k1")]);
  const wrong = releaseSessionLock("S1", "pool4", "k2");
  assert(wrong === false, "releasing a DIFFERENT key is a no-op");
}

// ─── 6. Stale lock sweep ───────────────────────────────
console.log("\n[6] stale lock sweep");
clearAllLocks();
{
  // Force a lock with an ancient lastUsedAt.
  const candidates = [key("k1")];
  acquireSessionLock("S1", "pool5", candidates);
  assert(countStaleLocks() === 0, "fresh lock is not stale");

  // Backdate the lock beyond the TTL.
  const held = getSessionLockedKey("S1", "pool5")!;
  held.lastUsedAt = Date.now() - (DEFAULT_SESSION_LOCK_TTL_MS + 60_000);
  const dropped = countStaleLocks();
  assert(dropped === 1, "stale lock (past TTL) is dropped");
  assert(countLocks() === 0, "no locks remain after stale sweep");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
