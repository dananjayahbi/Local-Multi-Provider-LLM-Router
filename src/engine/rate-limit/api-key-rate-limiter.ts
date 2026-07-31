const WINDOW_MS = 60_000;

interface TokenRecord {
  reservationId: string;
  timestamp: number;
  tokens: number;
}

interface KeyWindowState {
  requestTimestamps: number[];
  tokenRecords: TokenRecord[];
  tail: Promise<void>;
}

export interface ApiKeyRateLimitReservation {
  apiKeyId: string;
  reservationId: string;
  reservedTokens: number;
  hasTpmLimit: boolean;
}

interface WaitForApiKeyRateLimitInput {
  apiKeyId: string;
  rpmLimit?: number | null;
  tpmLimit?: number | null;
  requestedTokens: number;
}

const windowStateByKey = new Map<string, KeyWindowState>();

function getKeyState(apiKeyId: string): KeyWindowState {
  const existing = windowStateByKey.get(apiKeyId);
  if (existing) return existing;

  const initial: KeyWindowState = {
    requestTimestamps: [],
    tokenRecords: [],
    tail: Promise.resolve(),
  };

  windowStateByKey.set(apiKeyId, initial);
  return initial;
}

function pruneExpired(state: KeyWindowState, now: number): void {
  while (state.requestTimestamps.length > 0 && now - state.requestTimestamps[0] >= WINDOW_MS) {
    state.requestTimestamps.shift();
  }

  while (state.tokenRecords.length > 0 && now - state.tokenRecords[0].timestamp >= WINDOW_MS) {
    state.tokenRecords.shift();
  }
}

function getRpmWaitMs(state: KeyWindowState, now: number, rpmLimit: number | null): number {
  if (!rpmLimit || rpmLimit <= 0) return 0;
  if (state.requestTimestamps.length < rpmLimit) return 0;

  const oldest = state.requestTimestamps[0];
  return Math.max(1, oldest + WINDOW_MS - now);
}

function getTpmWaitMs(
  state: KeyWindowState,
  now: number,
  tpmLimit: number | null,
  requestedTokens: number
): number {
  if (!tpmLimit || tpmLimit <= 0) return 0;

  const totalTokensInWindow = state.tokenRecords.reduce((sum, entry) => sum + entry.tokens, 0);
  if (totalTokensInWindow + requestedTokens <= tpmLimit) return 0;

  let tokensToFree = totalTokensInWindow + requestedTokens - tpmLimit;
  for (const record of state.tokenRecords) {
    tokensToFree -= record.tokens;
    if (tokensToFree <= 0) {
      return Math.max(1, record.timestamp + WINDOW_MS - now);
    }
  }

  return WINDOW_MS;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reserveWithinWindow(
  state: KeyWindowState,
  apiKeyId: string,
  rpmLimit: number | null,
  tpmLimit: number | null,
  requestedTokens: number
): Promise<ApiKeyRateLimitReservation> {
  const normalizedRequestedTokens = Math.max(1, Math.floor(requestedTokens));

  while (true) {
    const now = Date.now();
    pruneExpired(state, now);

    const waitRpmMs = getRpmWaitMs(state, now, rpmLimit);
    const waitTpmMs = getTpmWaitMs(state, now, tpmLimit, normalizedRequestedTokens);
    const waitMs = Math.max(waitRpmMs, waitTpmMs);

    if (waitMs <= 0) {
      const reservationId = crypto.randomUUID();
      state.requestTimestamps.push(now);
      state.tokenRecords.push({
        reservationId,
        timestamp: now,
        tokens: normalizedRequestedTokens,
      });

      return {
        apiKeyId,
        reservationId,
        reservedTokens: normalizedRequestedTokens,
        hasTpmLimit: Boolean(tpmLimit && tpmLimit > 0),
      };
    }

    await delay(waitMs);
  }
}

export async function waitForApiKeyRateLimit(
  input: WaitForApiKeyRateLimitInput
): Promise<ApiKeyRateLimitReservation> {
  const rpmLimit = input.rpmLimit ?? null;
  const tpmLimit = input.tpmLimit ?? null;
  const hasRateLimits = Boolean((rpmLimit && rpmLimit > 0) || (tpmLimit && tpmLimit > 0));

  if (!hasRateLimits) {
    return {
      apiKeyId: input.apiKeyId,
      reservationId: "",
      reservedTokens: Math.max(1, Math.floor(input.requestedTokens)),
      hasTpmLimit: false,
    };
  }

  const state = getKeyState(input.apiKeyId);
  const task = state.tail.then(
    () => reserveWithinWindow(state, input.apiKeyId, rpmLimit, tpmLimit, input.requestedTokens),
    () => reserveWithinWindow(state, input.apiKeyId, rpmLimit, tpmLimit, input.requestedTokens)
  );

  state.tail = task.then(() => undefined, () => undefined);
  return task;
}

export async function settleApiKeyRateLimit(
  reservation: ApiKeyRateLimitReservation,
  actualTotalTokens?: number | null
): Promise<void> {
  if (!reservation.reservationId || !reservation.hasTpmLimit) {
    return;
  }

  const normalizedActualTokens =
    actualTotalTokens && Number.isFinite(actualTotalTokens)
      ? Math.max(1, Math.floor(actualTotalTokens))
      : reservation.reservedTokens;

  const state = getKeyState(reservation.apiKeyId);
  const task = state.tail.then(
    () => {
      const now = Date.now();
      pruneExpired(state, now);

      const record = state.tokenRecords.find((entry) => entry.reservationId === reservation.reservationId);
      if (!record) return;
      record.tokens = normalizedActualTokens;
    },
    () => {
      const now = Date.now();
      pruneExpired(state, now);

      const record = state.tokenRecords.find((entry) => entry.reservationId === reservation.reservationId);
      if (!record) return;
      record.tokens = normalizedActualTokens;
    }
  );

  state.tail = task.then(() => undefined, () => undefined);
  await task;
}

// ─── Live Snapshot (for charts + queue indicator) ──────

export interface KeyRateSnapshot {
  apiKeyId: string;
  rpmCurrent: number;
  tpmCurrent: number;
  isWaiting: boolean;        // any request currently queued for this key
  waitingCount: number;      // approximate # of queued reservations
}

export function getAllKeyRateSnapshots(): KeyRateSnapshot[] {
  const now = Date.now();
  const snapshots: KeyRateSnapshot[] = [];

  for (const [apiKeyId, state] of windowStateByKey.entries()) {
    // Count expired without mutating the real arrays (shift is done by prune, so we do a filtered read)
    const validRequestTs = state.requestTimestamps.filter((ts) => now - ts < WINDOW_MS);
    const validTokenRecords = state.tokenRecords.filter((r) => now - r.timestamp < WINDOW_MS);
    const tokenSum = validTokenRecords.reduce((s, r) => s + r.tokens, 0);

    snapshots.push({
      apiKeyId,
      rpmCurrent: validRequestTs.length,
      tpmCurrent: tokenSum,
      isWaiting: validRequestTs.length > 0 || validTokenRecords.length > 0,
      waitingCount: validRequestTs.length,
    });
  }

  return snapshots;
}

export function getKeyRateSnapshot(apiKeyId: string): KeyRateSnapshot | null {
  const state = windowStateByKey.get(apiKeyId);
  if (!state) return null;

  const now = Date.now();
  const validRequestTs = state.requestTimestamps.filter((ts) => now - ts < WINDOW_MS);
  const validTokenRecords = state.tokenRecords.filter((r) => now - r.timestamp < WINDOW_MS);
  const tokenSum = validTokenRecords.reduce((s, r) => s + r.tokens, 0);

  return {
    apiKeyId,
    rpmCurrent: validRequestTs.length,
    tpmCurrent: tokenSum,
    isWaiting: validRequestTs.length > 0 || validTokenRecords.length > 0,
    waitingCount: validRequestTs.length,
  };
}
