// ─── Error Classifier ───────────────────────────────────
// Classifies upstream errors into one of the taxonomy
// specified in §10.1 of the architecture plan.
//
// Task 03: real-world provider responses are often ambiguous (e.g. a 502 with
// no structured body, a 408 timeout, or a 404 from a wrong path). Instead of
// collapsing everything unrecognized into "UNKNOWN", we now map common HTTP
// statuses to a meaningful classification and, crucially, keep the ORIGINAL
// provider message/code so the /logs page can display exactly what happened
// (e.g. "502 Bad Gateway" rather than a bare "Unknown").

export type ErrorClassification =
  | "QUOTA_EXCEEDED"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "NETWORK_ERROR"
  | "AUTH_ERROR"
  | "INVALID_REQUEST"
  | "UNKNOWN";

export interface ClassifiedError {
  classification: ErrorClassification;
  httpStatus: number;
  providerErrorMessage: string;
  providerErrorCode: string | null;
}

const QUOTA_KEYWORDS = ["quota", "billing", "insufficient", "balance", "payment", "exceeded", "limit reached"];
const RATE_KEYWORDS = ["rate limit", "rate_limit", "too many requests", "throttl", "429"];

function bodyContainsQuota(message: string): boolean {
  const lower = message.toLowerCase();
  return QUOTA_KEYWORDS.some((kw) => lower.includes(kw));
}

function bodyContainsRateLimit(message: string): boolean {
  const lower = message.toLowerCase();
  return RATE_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Human-friendly label for a classification. Used by the /logs page badge so a
 * "Server Error" shows as such instead of a bare taxonomy slug.
 */
export function classificationLabel(classification: ErrorClassification): string {
  switch (classification) {
    case "QUOTA_EXCEEDED": return "Quota Exceeded";
    case "RATE_LIMITED": return "Rate Limited";
    case "SERVER_ERROR": return "Server Error";
    case "NETWORK_ERROR": return "Network Error";
    case "AUTH_ERROR": return "Auth Error";
    case "INVALID_REQUEST": return "Invalid Request";
    case "UNKNOWN": return "Unknown";
    default: return classification;
  }
}

export function classifyError(
  httpStatus: number,
  providerErrorCode: string | null,
  providerErrorMessage: string,
  _apiFormat?: string
): ClassifiedError {
  const body = providerErrorMessage ?? "";
  const base: Omit<ClassifiedError, "classification"> = {
    httpStatus,
    providerErrorMessage: body || `HTTP ${httpStatus || "?"}`,
    providerErrorCode,
  };

  // Network-level errors (passed as 0 status)
  if (httpStatus === 0) {
    return { ...base, classification: "NETWORK_ERROR" };
  }

  // 401 → auth (check before 4xx generic catches below)
  if (httpStatus === 401) {
    return { ...base, classification: "AUTH_ERROR" };
  }

  // 402/403 → quota (or an explicit quota wording anywhere)
  if (httpStatus === 402 || httpStatus === 403) {
    return { ...base, classification: "QUOTA_EXCEEDED" };
  }

  // 429 with quota wording → quota, else rate-limited
  if (httpStatus === 429) {
    if (bodyContainsQuota(body)) {
      return { ...base, classification: "QUOTA_EXCEEDED" };
    }
    return { ...base, classification: "RATE_LIMITED" };
  }

  // 400 → invalid request (don't penalize)
  // 404 → model/path not found — not the key's fault; treat as invalid request.
  if (httpStatus === 400 || httpStatus === 404) {
    return { ...base, classification: "INVALID_REQUEST" };
  }

  // 408 → explicit request timeout (transient server-side, retriable).
  if (httpStatus === 408 || httpStatus === 409 || httpStatus === 425) {
    return { ...base, classification: "SERVER_ERROR" };
  }

  // 5xx → server error (502/503/504 etc. all transient).
  if (httpStatus >= 500 && httpStatus <= 599) {
    return { ...base, classification: "SERVER_ERROR" };
  }

  // Any 4xx that mentions rate/limit wording → rate-limited.
  if (httpStatus >= 400 && httpStatus < 500 && bodyContainsRateLimit(body)) {
    return { ...base, classification: "RATE_LIMITED" };
  }

  // Anything unrecognized → UNKNOWN (treated as server error downstream).
  return { ...base, classification: "UNKNOWN" };
}
