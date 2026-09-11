// ─── Single Key Attempt Helper ─────────────────────────
// Encapsulates ONE upstream request to a provider, classifying the outcome so
// the orchestrator can decide whether to silently retry (task 04) or apply a
// penalty. Network-level failures (fetch throw / timeouts) are normalized to a
// retriable classification here, so the orchestrator's retry loop can treat
// them uniformly with 5xx server errors.
//
// This returns a full `UpstreamAttempt` on BOTH paths — it does NOT throw for
// fetch failures. Refactors the former try/catch fetch block out of the
// orchestrator's candidate loop so the silent-retry loop stays readable.

import { classifyError, ErrorClassification } from "../error-classifier";
import { getAdapter } from "../adapters";
import { isRetriable, backoffAfterFailure, MAX_ATTEMPTS } from "./retry-backoff";
import { withDispatcher } from "./dispatcher";

export interface UpstreamAttempt {
  ok: boolean;
  /** The raw Response object for a successful attempt (so the caller can stream). */
  response?: Response;
  httpStatus: number;
  latencyMs: number;
  providerErrorMessage: string;
  providerErrorCode: string | null;
  /** Error taxonomy, or synthetic label for network failures. Empty on success. */
  classification: ErrorClassification | "";
  /** Raw message (provider error message or thrown error text). */
  message: string;
  isNetwork: boolean;
}

/**
 * Perform a single upstream fetch. Never throws for provider/network failures —
 * always returns a structured result.
 */
export async function sendKeyAttempt(
  req: { url: string; headers: Record<string, string>; body: string },
  adapter: ReturnType<typeof getAdapter>,
  apiFormat: string
): Promise<UpstreamAttempt> {
  const start = Date.now();
  try {
    const response = await fetch(req.url, withDispatcher({
      method: "POST",
      headers: req.headers,
      body: req.body,
      signal: AbortSignal.timeout(300_000), // 5 min timeout
    }));
    const latencyMs = Date.now() - start;

    if (!response.ok) {
      const errorBody = await response.text();
      const parsed = adapter.parseError(errorBody, response.status);
      const classified = classifyError(
        response.status,
        parsed.providerErrorCode,
        parsed.providerErrorMessage,
        apiFormat
      );
      return {
        ok: false,
        httpStatus: response.status,
        latencyMs,
        providerErrorMessage: classified.providerErrorMessage,
        providerErrorCode: classified.providerErrorCode,
        classification: classified.classification,
        message: classified.providerErrorMessage,
        isNetwork: false,
      };
    }

    return {
      ok: true,
      response,
      httpStatus: response.status,
      latencyMs,
      providerErrorMessage: "",
      providerErrorCode: null,
      classification: "",
      message: "",
      isNetwork: false,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const isNetworkError =
      err instanceof TypeError ||
      (err instanceof Error &&
        (err.message.includes("fetch") ||
          err.message.includes("ECONN") ||
          err.message.includes("ENOTFOUND") ||
          err.message.includes("timeout") ||
          err.name === "AbortError"));
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      httpStatus: 0,
      latencyMs,
      providerErrorMessage: message,
      providerErrorCode: isNetworkError ? "NETWORK" : null,
      classification: isNetworkError ? "NETWORK_ERROR" : "UNKNOWN",
      message,
      isNetwork: isNetworkError,
    };
  }
}

export interface TransientFailureInfo {
  httpStatus: number;
  classification: ErrorClassification;
  providerErrorMessage: string;
  providerErrorCode: string | null;
  message: string;
}

export interface RetryAttemptResult {
  ok: boolean;
  /** Present when `ok` is true. */
  response?: Response;
  httpStatus: number;
  /** Taxonomy for a failed attempt; empty string when the attempt succeeded. */
  classification: ErrorClassification | "";
  providerErrorMessage: string;
  providerErrorCode: string | null;
  message: string;
  /** Total attempts made for this key (initial + silent retries). */
  attempts: number;
  /**
   * True when the retry budget was exhausted and the key should now be
   * penalized. False when the error is non-retriable (immediate penalty path).
   */
  exhausted: boolean;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Perform one key attempt, silently retrying retriable transient errors
 * (SERVER_ERROR / NETWORK_ERROR / UNKNOWN) with an increasing backoff —
 * see `retry-backoff.ts` for the exact 3→6→10→15→30s schedule. No penalty is
 * applied for the transient attempts; only the final (exhausted) attempt
 * signals the caller to penalize. Rate limits / quota / auth / invalid are
 * never retried here (non-retriable).
 *
 * @param onTransient Called after each transient failure BEFORE the backoff
 *   wait, so the caller can log the attempt without applying a penalty.
 */
export async function performKeyAttemptWithRetry(
  req: { url: string; headers: Record<string, string>; body: string },
  adapter: ReturnType<typeof getAdapter>,
  apiFormat: string,
  onTransient?: (info: TransientFailureInfo, attempt: number) => void | Promise<void>
): Promise<RetryAttemptResult> {
  let attempts = 0;
  while (true) {
    attempts++;
    const result = await sendKeyAttempt(req, adapter, apiFormat);

    if (result.ok) {
      return {
        ok: true,
        response: result.response,
        httpStatus: result.httpStatus,
        classification: "",
        providerErrorMessage: "",
        providerErrorCode: null,
        message: "",
        attempts,
        exhausted: false,
      };
    }

    const canRetry = isRetriable(result.classification) && attempts < MAX_ATTEMPTS;
    if (canRetry) {
      const info: TransientFailureInfo = {
        httpStatus: result.httpStatus,
        classification: result.classification as ErrorClassification,
        providerErrorMessage: result.providerErrorMessage,
        providerErrorCode: result.providerErrorCode,
        message: result.message,
      };
      if (onTransient) await onTransient(info, attempts);
      await delay(backoffAfterFailure(attempts));
      continue;
    }

    // Non-retriable (rate limit/quota/auth/invalid) OR retry budget exhausted.
    return {
      ok: false,
      httpStatus: result.httpStatus,
      classification: result.classification,
      providerErrorMessage: result.providerErrorMessage,
      providerErrorCode: result.providerErrorCode,
      message: result.message,
      attempts,
      exhausted: attempts >= MAX_ATTEMPTS,
    };
  }
}

