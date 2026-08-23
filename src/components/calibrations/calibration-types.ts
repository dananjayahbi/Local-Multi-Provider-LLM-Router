// ─── Auto-Calibrations shared types ───────────────────
// Shapes returned by `/api/admin/auto-calibrations`.

export type AutoCalibrationEventKind =
  | "FAILURE"
  | "SUCCESS"
  | "SCALE_DOWN"
  | "SCALE_UP"
  | "BASELINE_RESET";

export interface AutoCalibrationDetailedLimits {
  rpmLimit?: number | null;
  tpmLimit?: number | null;
  rpdLimit?: number | null;
  tpdLimit?: number | null;
}

export interface AutoCalibrationEvent {
  id: string;
  kind: AutoCalibrationEventKind;
  limit: string | null;
  message: string;
  detail: {
    classification?: string;
    streak?: number;
    before?: AutoCalibrationDetailedLimits;
    after?: AutoCalibrationDetailedLimits;
    baseline?: AutoCalibrationDetailedLimits;
  } | null;
  createdAt: string;
  key: {
    id: string;
    label: string;
    autoCalibration: boolean;
    provider: { id: string; name: string };
  };
}

export interface AutoCalibrationState {
  baseline: AutoCalibrationDetailedLimits;
  consecutiveSuccesses: number;
  lastAdjustmentAt: number | null;
}

export interface AutoCalibrationKey {
  id: string;
  label: string;
  status: string;
  penaltyLevel: number;
  penaltyExpiresAt: string | null;
  autoCalibration: boolean;
  autoCalibrationState: AutoCalibrationState | null;
  rpmLimit: number | null;
  tpmLimit: number | null;
  rpdLimit: number | null;
  tpdLimit: number | null;
  tps: number | null;
  provider: { id: string; name: string };
}

export interface AutoCalibrationData {
  events: AutoCalibrationEvent[];
  keys: AutoCalibrationKey[];
}
