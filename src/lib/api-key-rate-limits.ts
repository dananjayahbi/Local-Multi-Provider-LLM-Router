export type ParsedRateLimitValue = number | null | undefined;

type ParseMode = "create" | "update";

interface ParseRateLimitOptions {
  mode: ParseMode;
  fieldName: "rpmLimit" | "tpmLimit";
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
  const { mode, fieldName } = options;

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
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return { error: `${fieldName} must be a positive integer or unlimited` , value: undefined };
    }

    return { value: parsed };
  }

  if (typeof rawValue === "number") {
    if (!Number.isInteger(rawValue) || rawValue <= 0) {
      return { error: `${fieldName} must be a positive integer or unlimited`, value: undefined };
    }
    return { value: rawValue };
  }

  return { error: `${fieldName} must be a positive integer or unlimited`, value: undefined };
}
