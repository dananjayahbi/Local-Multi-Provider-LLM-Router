// ─── Backup / Restore Types ─────────────────────────────
// Shared TypeScript shapes for the router configuration
// backup payload. This captures the CONFIG domain (providers,
// keys, models, pools, settings) and deliberately excludes
// transient operational data (request logs, discovery/chat/
// calibration sessions, benchmarks) so a restore returns the
// router to a clean, known configured state.

export interface BackupMeta {
  app: string;
  version: number;
  createdAt: string;
  counts: {
    providers: number;
    apiKeys: number;
    providerModels: number;
    pools: number;
    poolApiKeys: number;
    poolMembers: number;
    appSettings: number;
    benchmarkConfig: number;
  };
}

export interface ProviderBackup {
  id: string;
  name: string;
  baseUrl: string;
  apiFormat: string;
  notes: string | null;
  draftProviderId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKeyBackup {
  id: string;
  poolId: string | null;
  providerId: string;
  label: string;
  secret: string | null;
  secretEncrypted: string | null;
  rpmLimit: number | null;
  tpmLimit: number | null;
  rpdLimit: number | null;
  tpdLimit: number | null;
  tps: number | null;
  timeToFirstTokenMs: number | null;
  contextWindow: number | null;
  cacheCapable: boolean;
  cacheDiscountFactor: number;
  maxRpmLimit: number | null;
  maxTpmLimit: number | null;
  maxRpdLimit: number | null;
  maxTpdLimit: number | null;
  minRpmLimit: number | null;
  minTpmLimit: number | null;
  minRpdLimit: number | null;
  minTpdLimit: number | null;
  floorHitAt: Date | null;
  status: string;
  manuallyDisabled: boolean;
  penaltyLevel: number;
  penaltyExpiresAt: Date | null;
  lastPenaltyEndedAt: Date | null;
  suspendedReason: string | null;
  penaltyType: string | null;
  penaltyReason: string | null;
  consecutiveFailures: number;
  calibrated: boolean;
  lastCalibratedAt: Date | null;
  autoCalibration: boolean;
  autoCalibrationState: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProviderModelBackup {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  supportsVision: boolean;
  supportsFunctionCalling: boolean;
  contextWindow: number | null;
  enabled: boolean;
  reliableToolCalling: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PoolBackup {
  id: string;
  name: string;
  virtualModelName: string;
  description: string | null;
  routingStrategy: string;
  gatewayKey: string | null;
  gatewayKeyPrefix: string | null;
  cacheAware: boolean;
  stickyContextTokenBudget: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PoolApiKeyBackup {
  id: string;
  poolId: string;
  apiKeyId: string;
  createdAt: Date;
}

export interface PoolMemberBackup {
  id: string;
  poolId: string;
  providerModelId: string;
  priority: number;
}

export interface AppSettingsBackup {
  id: string;
  unifiedGatewayKeyHash: string;
  unifiedGatewayKeyPrefix: string;
  penaltyBaseCooldownSeconds: number;
  penaltyMultiplier: number;
  penaltyMaxCooldownSeconds: number;
  penaltyResetWindowSeconds: number;
}

export interface BenchmarkConfigBackup {
  id: string;
  baselineProviderModelId: string | null;
  targetTps: number;
  targetRpm: number;
  ttftDriftThreshold: number;
  tpsDriftThreshold: number;
  postTestCooldownSeconds: number;
  maxParallelTests: number;
  updatedAt: Date;
}

export interface BackupPayload {
  meta: BackupMeta;
  providers: ProviderBackup[];
  apiKeys: ApiKeyBackup[];
  providerModels: ProviderModelBackup[];
  pools: PoolBackup[];
  poolApiKeys: PoolApiKeyBackup[];
  poolMembers: PoolMemberBackup[];
  appSettings: AppSettingsBackup | null;
  benchmarkConfig: BenchmarkConfigBackup | null;
}
