// ─── Error Classifier ───────────────────────────────────
// Classifies upstream errors into one of the taxonomy
// specified in §10.1 of the architecture plan.

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

function bodyContainsQuota(message: string): boolean {
  const lower = message.toLowerCase();
  return QUOTA_KEYWORDS.some((kw) => lower.includes(kw));
}

export function classifyError(
  httpStatus: number,
  providerErrorCode: string | null,
  providerErrorMessage: string,
  _apiFormat?: string
): ClassifiedError {
  const base: Omit<ClassifiedError, "classification"> = {
    httpStatus,
    providerErrorMessage,
    providerErrorCode,
  };

  // Network-level errors (passed as 0 status)
  if (httpStatus === 0) {
    return { ...base, classification: "NETWORK_ERROR" };
  }

  // 402/403 → quota
  if (httpStatus === 402 || httpStatus === 403) {
    return { ...base, classification: "QUOTA_EXCEEDED" };
  }

  // 429 with quota wording → quota, else rate-limited
  if (httpStatus === 429) {
    if (bodyContainsQuota(providerErrorMessage)) {
      return { ...base, classification: "QUOTA_EXCEEDED" };
    }
    return { ...base, classification: "RATE_LIMITED" };
  }

  // 5xx → server error
  if (httpStatus >= 500 && httpStatus <= 599) {
    return { ...base, classification: "SERVER_ERROR" };
  }

  // 401 → auth
  if (httpStatus === 401) {
    return { ...base, classification: "AUTH_ERROR" };
  }

  // 400 → invalid request (don't penalize)
  if (httpStatus === 400) {
    return { ...base, classification: "INVALID_REQUEST" };
  }

  // Anything unrecognized → UNKNOWN (treated as server error)
  return { ...base, classification: "UNKNOWN" };
}
