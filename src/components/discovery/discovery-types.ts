// ─── Discovery Pipeline Types ──────────────────────────

export interface DiscoveredModel {
  modelId: string;
  displayName?: string;
  supportsVision?: boolean;
  supportsFunctionCalling?: boolean;
  contextWindow?: number | null;
}

/** A model the user has curated for configuration — either picked from the
 *  discovered list or typed in manually by model ID. `manual` marks ones added
 *  by hand (used to style/allow removal). */
export interface CuratedModel {
  modelId: string;
  displayName?: string;
  supportsVision?: boolean;
  supportsFunctionCalling?: boolean;
  contextWindow?: number | null;
  manual?: boolean;
}

export interface ProviderModel {
  id: string;
  modelId: string;
  displayName: string;
  supportsVision: boolean;
  supportsFunctionCalling: boolean;
  contextWindow: number | null;
  enabled: boolean;
}

export interface ProviderApiKey {
  id: string;
  label: string;
  secret: string | null;
  status: string;
  penaltyLevel: number;
  rpmLimit: number | null;
  tpmLimit: number | null;
  rpdLimit: number | null;
  tpdLimit: number | null;
  tps: number | null;
  timeToFirstTokenMs: number | null;
  contextWindow: number | null;
  autoCalibration?: boolean;
  poolApiKeys?: { poolId: string }[];
}

export interface LinkedProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiFormat: string;
  apiKeys: ProviderApiKey[];
  providerModels: ProviderModel[];
}

export interface Draft {
  id: string;
  name: string;
  baseUrl: string;
  apiFormat: string;
  sourceUrl: string | null;
  stage: string; // RAW | APPROVED | CONFIGURED | REJECTED
  status: string;
  discoveredModels: string;
  details: string | null;
  notes: string | null;
  createdAt: string;
  provider: LinkedProvider | null;
}

export function parseDiscoveredModels(draft: Draft): DiscoveredModel[] {
  try {
    const parsed = JSON.parse(draft.discoveredModels);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    /* ignore */
  }
  return [];
}

export function parseDetails(draft: Draft): Record<string, unknown> | null {
  if (!draft.details) return null;
  try {
    return JSON.parse(draft.details);
  } catch {
    return null;
  }
}

export const STAGES = ["RAW", "APPROVED", "CONFIGURED"] as const;
