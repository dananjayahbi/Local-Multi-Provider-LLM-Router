// ─── Manual Penalty Decision ────────────────────────────
// Resolves the cooldown + level for a MANUALLY applied penalty (admin UI).
// Two modes:
//
//   level  — derive cooldown from the VARIABLE backoff:
//            baseCooldown × multiplier^(level-1), capped at maxCooldown.
//            Escalation is deterministic by the chosen level, so an operator
//            can "bump" a key's penalty predictably.
//
//   custom — override with an explicit cooldown in seconds. The operator is
//            trusted to know the duration; we only clamp negatives to a min.

export interface ManualPenaltyInput {
  /** 1-based escalation level (1..5+). Ignored when cooldownSeconds is set. */
  level?: number;
  /** Explicit cooldown in seconds. Overrides `level`. */
  cooldownSeconds?: number;
}

export interface ManualPenaltyDecision {
  penaltyLevel: number;
  cooldownSeconds: number;
  penaltyType: "VARIABLE";
  penaltyReason: "manual";
}

export interface ManualPenaltySettings {
  baseCooldown: number;
  multiplier: number;
  maxCooldown: number;
}

/** Minimum usable cooldown so a manual penalty is never instant/no-op. */
const MIN_COOLDOWN_SECONDS = 10;

export function resolveManualPenalty(
  input: ManualPenaltyInput,
  settings: ManualPenaltySettings
): ManualPenaltyDecision {
  // Custom timer takes precedence over level-based derivation.
  if (input.cooldownSeconds != null && input.cooldownSeconds > 0) {
    return {
      penaltyLevel: input.level ?? 1,
      cooldownSeconds: Math.max(input.cooldownSeconds, MIN_COOLDOWN_SECONDS),
      penaltyType: "VARIABLE",
      penaltyReason: "manual",
    };
  }

  const level = Math.max(1, Math.round(input.level ?? 1));
  const derived = settings.baseCooldown * Math.pow(settings.multiplier, level - 1);
  const cooldownSeconds = Math.min(Math.max(derived, MIN_COOLDOWN_SECONDS), settings.maxCooldown);

  return {
    penaltyLevel: level,
    cooldownSeconds,
    penaltyType: "VARIABLE",
    penaltyReason: "manual",
  };
}
