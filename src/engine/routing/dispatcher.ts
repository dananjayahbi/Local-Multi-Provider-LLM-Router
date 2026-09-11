// ─── Upstream Connection Dispatcher ─────────────────────
// Upstream calls previously used a plain global `fetch()` with no explicit
// keep-alive, so every attempt paid a fresh TCP + TLS handshake. Reusing pooled
// sockets materially reduces time-to-first-token on repeat calls to the same
// provider host (see docs/10-proxy-universal-client-fidelity-and-ttft-plan.md).
//
// We use undici's `Agent` when available. `undici` is bundled with Node >=18
// and is not a declared dependency here, so we load it lazily and fall back to
// `undefined` (plain fetch) if it cannot be resolved — the code must compile
// and run even where undici is absent.

type DispatcherLike = unknown;

let cached: DispatcherLike | undefined;
let initialized = false;

/**
 * Returns a keep-alive dispatcher suitable for the `dispatcher` option of
 * fetch(), or `undefined` when undici is unavailable (caller should then use a
 * plain fetch).
 */
export function getUpstreamDispatcher(): DispatcherLike | undefined {
  if (initialized) return cached;
  initialized = true;
  try {
    // Lazy require keeps this out of the module graph for edge/other runtimes
    // and lets the build succeed without an explicit undici dependency.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const undici = require("undici") as { Agent?: new (opts: Record<string, unknown>) => DispatcherLike };
    if (undici?.Agent) {
      cached = new undici.Agent({
        keepAliveTimeout: 30_000,
        keepAliveMaxTimeout: 60_000,
        connections: 16,
        pipelining: 1,
      });
    }
  } catch {
    cached = undefined;
  }
  return cached;
}

/**
 * Build the fetch init object, adding the keep-alive dispatcher ONLY when one
 * could be created. Keeping this in one place avoids spreading `as any` casts
 * across call sites.
 */
export function withDispatcher(init: RequestInit): RequestInit {
  const dispatcher = getUpstreamDispatcher();
  if (!dispatcher) return init;
  return { ...init, dispatcher } as RequestInit & { dispatcher: DispatcherLike };
}
