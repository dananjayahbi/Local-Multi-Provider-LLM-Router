// ─── Pool Shared Types ─────────────────────────────────
// Shared across the pools list page, filter bar, and detail page. `createdAt`
// is included so list pages can sort pools by their creation date.

export interface PoolItem {
  id: string;
  name: string;
  virtualModelName: string;
  description?: string | null;
  routingStrategy: string;
  gatewayKey: string;
  gatewayKeyPrefix: string | null;
  createdAt: string;
  _count: { poolMembers: number };
  healthyKeys: number;
  totalKeys: number;
}
