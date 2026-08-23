// ─── Penalty Type Decision ────────────────────────────
// Task 04: two kinds of penalties, chosen based on what actually failed:
//
//   PRE_DEFINED — tied to a SPECIFIC limit that was hit (RPM / TPM / RPD /
//                 TPD). Duration matches the limit's natural window, so a
//                 RPM hit gets ~a minute and a TPD hit gets ~a day. This is
//                 the efficient choice: "a 10-minute penalty on an RPM hit is
//                 useless."
//
//   VARIABLE    — escalating cooldown for recoverable errors where we can't
//                 pin down a single limit (SERVER_ERROR, NETWORK_ERROR, or a
//                 bare RATE_LIMITED with no limit clue). It depends on the
//                 key's penalty history AND is dampened by auto-calibration
//                 (which keeps the key's limits low enough to avoid tripping
//                 penalties in the first place).

import { ErrorClassification } from "./error-classifier";
import { LimitName } from "./playground/types";
import { LIMIT_PENALTY_SECONDS } from "./playground/penalty";

export type PenaltyType = "VARIABLE" | "PRE_DEFINED";

export interface PenaltyDecision {
  penaltyType: PenaltyType;
  /** Machine-readable reason sorted into the DB (`penaltyReason`). */
  penaltyReason: string;
  /** Human-friendly label for the timeline / badges. */
  penaltyLabel: string;
  cooldownSeconds: number;
  /** Escalation level for VARIABLE penalties (0 for pre-defined, which resets). */
  penaltyLevel: number;
}

// ─── Limit detection from origin errors ────────────────
const LIMIT_PATTERNS: { limit: LimitName; patterns: RegExp[] }[] = [
  {
    limit: "TPD",
    patterns: [/tokens?\s+per\s+day/i, /daily\s+token/i, /token\s+quota.*day/i, /tokens.*24\s*hours/i],
  },
  {
    limit: "RPD",
    patterns: [/requests?\s+per\s+day/i, /daily\s+request/i, /request\s+(?:quota|limit).*day/i, /requests.*24\s*hours/i],
  },
  {
    limit: "TPM",
    patterns: [/tokens?\s+per\s+minute/i, /minute\s+token/i, /token\s+(?:quota|limit).*minute/i],
  },
  {
    limit: "RPM",
    patterns: [/requests?\s+per\s+minute/i, /per\s+minute/i, /request\s+(?:quota|limit).*minute/i, /too\s+many\s+requests/i, /rate\s+limit/i],
  },
];

/**
 * Best-effort detection of WHICH limit the origin provider complained about,
 * from the classified error + the raw provider message/code. Returns null when
 * we can't tell (→ VARIABLE penalty).
 */
export function detectLimitFromError(
  classification: ErrorClassification,
  message: string | null,
  code: string | null
): LimitName | null {
  if (classification !== "RATE_LIMITED") return null;

  const haystack = `${message ?? ""} ${code ?? ""}`;
  // Check in order of "most specific" first: TPD/RPD (daily) before TPM/RPM.
  for (const { limit, patterns } of LIMIT_PATTERNS) {
    if (patterns.some((re) => re.test(haystack))) return limit;
  }
  return null;
}

/**
 * Decide the penalty to apply. `limit` is the detected limit (may be null).
 * `settings` carries the variable-penalty backoff config. `penaltyLevel` is the
 * key's current level BEFORE this failure — used to compute the variable ramp.
 */
export function resolvePenaltyDecision(
  classification: ErrorClassification,
  limit: LimitName | null,
  context: {
    currentPenaltyLevel: number;
    lastPenaltyEndedAt: Date | null;
    now: Date;
    autoCalibration: boolean;
  },
  settings: {
    baseCooldown: number;
    multiplier: number;
    maxCooldown: number;
    resetWindowSeconds: number;
  }
): PenaltyDecision {
  // ── PRE_DEFINED: we know the specific limit that was hit ──
  // A bare 429 (RATE_LIMITED with no detectable limit text) is almost always
  // an RPM throttle — do NOT escalate it into a 10-minute VARIABLE cooldown.
  // Default to the short RPM penalty so the key recovers in ~a minute. This
  // matches the auto-calibrator, which also seeds RPM on an ambiguous throttle.
  const effectiveLimit = limit ?? (classification === "RATE_LIMITED" ? "RPM" : null);
  if (effectiveLimit) {
    const cooldownSeconds = LIMIT_PENALTY_SECONDS[effectiveLimit] ?? 60;
    return {
      penaltyType: "PRE_DEFINED",
      penaltyReason: effectiveLimit,
      penaltyLabel: `Hit ${effectiveLimit} limit`,
      cooldownSeconds,
      penaltyLevel: 0,
    };
  }

  // ── VARIABLE: escalating internal backoff for generic errors ──
  const shouldReset =
    context.currentPenaltyLevel === 0 ||
    !context.lastPenaltyEndedAt ||
    context.now.getTime() - context.lastPenaltyEndedAt.getTime() >
      settings.resetWindowSeconds * 1000;

  const newLevel = shouldReset ? 1 : context.currentPenaltyLevel + 1;
  const cooldownSeconds = Math.min(
    settings.baseCooldown * Math.pow(settings.multiplier, newLevel - 1),
    settings.maxCooldown
  );

  return {
    penaltyType: "VARIABLE",
    penaltyReason: classification,
    penaltyLabel: `Recoverable error (${classification})`,
    cooldownSeconds,
    penaltyLevel: newLevel,
  };
}
