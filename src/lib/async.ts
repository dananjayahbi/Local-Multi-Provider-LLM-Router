// ─── Async Utilities ────────────────────────────────────
// Fire-and-forget helper for bookkeeping that must NEVER block the response hot
// path (health resets, auto-calibration, request logging).
//
// Rationale (see docs/10-proxy-universal-client-fidelity-and-ttft-plan.md):
// awaiting these writes before the stream is returned held the first byte
// hostage to libsql/SQLite file-lock latency, adding seconds to TTFT. These
// operations are idempotent observability/health state, so their ordering
// relative to the client response is irrelevant — only that they eventually run.
//
// Rejections are logged and swallowed so a background failure can never crash a
// request or surface as an unhandled promise rejection.

export function fireAndForget(
  task: Promise<unknown> | (() => Promise<unknown>),
  label = "task"
): void {
  let p: Promise<unknown>;
  try {
    p = typeof task === "function" ? task() : task;
  } catch (err) {
    console.error(`[fireAndForget:${label}] sync throw: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  Promise.resolve(p).catch((err) => {
    console.error(`[fireAndForget:${label}] ${err instanceof Error ? err.message : String(err)}`);
  });
}
