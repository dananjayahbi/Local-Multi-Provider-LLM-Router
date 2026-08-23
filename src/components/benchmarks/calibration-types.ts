// Shared types for the calibration session UI.

export interface CalibrationOptionKey {
  id: string;
  label: string;
  calibrated: boolean;
  lastCalibratedAt: string | null;
}

export interface CalibrationOptionModel {
  id: string;
  displayName: string;
  contextWindow: number | null;
}

export interface CalibrationProviderOption {
  id: string;
  name: string;
  baseUrl: string;
  keys: CalibrationOptionKey[];
  models: CalibrationOptionModel[];
}

export interface RateLimitFindings {
  rpm?: number | null;
  tpm?: number | null;
  rpd?: number | null;
  tpd?: number | null;
  tps?: number | null;
  contextWindow?: number | null;
  timeToFirstTokenMs?: number | null;
  sources?: Array<{ label: string; url: string }>;
  notes?: string;
}

export interface CalibrationEvent {
  id: string;
  kind: string;
  message: string;
  detail: string | null;
  createdAt: string;
}

export interface CalibrationSession {
  id: string;
  providerId: string;
  apiKeyId: string;
  providerModelId: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  findings: string | null;
  applied: boolean;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  provider?: { id: string; name: string; baseUrl?: string } | null;
  apiKey?: { id: string; label: string } | null;
  providerModel?: { id: string; displayName: string } | null;
}

export type CalibrationStatus = CalibrationSession["status"];
