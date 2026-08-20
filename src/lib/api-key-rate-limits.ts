export type ParsedRateLimitValue = number | null | undefined;

type ParseMode = "create" | "update";

export type RateLimitFieldName =
  | "rpmLimit"
  | "tpmLimit"
  | "rpdLimit"
  | "tpdLimit"
  | "contextWindow";

interface ParseRateLimitOptions {
  mode: ParseMode;
  fieldName: RateLimitFieldName;
  allowFloat?: boolean; // for tps (tokens/sec)
}

interface ParseRateLimitResult {
  value: ParsedRateLimitValue;
  error?: string;
}

function isUnlimitedLiteral(input: string): boolean {
  const normalized = input.trim().toLowerCase();
  return normalized === "" || normalized === "unlimited" || normalized === "infinity" || normalized === "inf";
}

export function parseRateLimitInput(
  rawValue: unknown,
  options: ParseRateLimitOptions
): ParseRateLimitResult {
  const { mode, fieldName, allowFloat } = options;

  if (rawValue === undefined) {
    return { value: mode === "create" ? null : undefined };
  }

  if (rawValue === null) {
    return { value: null };
  }

  if (typeof rawValue === "string") {
    if (isUnlimitedLiteral(rawValue)) {
      return { value: null };
    }

    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return { error: `${fieldName} must be positive or unlimited`, value: undefined };
    }
    if (!allowFloat && !Number.isInteger(parsed)) {
      return { error: `${fieldName} must be a positive integer or unlimited`, value: undefined };
    }
    return { value: parsed };
  }

  if (typeof rawValue === "number") {
    if (!Number.isFinite(rawValue) || rawValue <= 0) {
      return { error: `${fieldName} must be positive or unlimited`, value: undefined };
    }
    if (!allowFloat && !Number.isInteger(rawValue)) {
      return { error: `${fieldName} must be a positive integer or unlimited`, value: undefined };
    }
    return { value: rawValue };
  }

  return { error: `${fieldName} must be positive or unlimited`, value: undefined };
}
