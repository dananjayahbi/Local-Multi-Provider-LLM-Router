// ─── Shared Gateway Fixture ───────────────────────────
// Helper for the scenario test scripts. Fetches live pools + keys from the
// running router, prompts the user (in the terminal) to pick a pool and the
// keys to exercise, and exposes a small typed client for sending real gateway
// requests + reading back the RequestLog rows they produce.
//
// These tests hit the REAL /api/gateway/v1/chat/completions endpoint so every
// run creates genuine RequestLog rows — visible in the /logs page and the
// rate-limit / flow-tracker state.

import { createInterface } from "node:readline/promises";

export const GATEWAY_BASE = process.env.GATEWAY_BASE ?? "http://localhost:4006";

// Reuse a single readline interface across all prompts. Creating a fresh one
// per prompt fails when stdin is piped (the new interface misses buffered input).
// The rl keeps the event loop alive, so we close it once stdin ends / on exit.
const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.on("close", () => process.exit(0));
rl.on("SIGINT", () => process.exit(0));

export interface PoolInfo {
  id: string;
  name: string;
  virtualModelName: string;
  gatewayKey: string | null;
  gatewayKeyPrefix: string | null;
}

export interface KeyInfo {
  id: string;
  label: string;
  providerName: string;
  status: string;
  rpmLimit: number | null;
  tpmLimit: number | null;
  poolIds: string[];
}

export interface LogRow {
  id: string;
  poolId: string | null;
  apiKeyId: string | null;
  apiKeyLabel: string;
  providerName: string;
  outcome: string; // SUCCESS, FAILURE
  errorClassification: string | null;
  httpStatus: number | null;
  latencyMs: number;
  requestedVirtualModel: string;
  createdAt: string;
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${GATEWAY_BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

/** List live pools the user can route through. */
export async function listPools(): Promise<PoolInfo[]> {
  const raw = await fetchJson<Array<Record<string, unknown>>>(`/api/admin/pools`);
  return raw.map((p) => ({
    id: String(p.id),
    name: String(p.name),
    virtualModelName: String(p.virtualModelName),
    gatewayKey: (p.gatewayKey as string) ?? null,
    gatewayKeyPrefix: (p.gatewayKeyPrefix as string) ?? null,
  }));
}

/** List live provider-level API keys. */
export async function listKeys(): Promise<KeyInfo[]> {
  const raw = await fetchJson<Array<Record<string, unknown>>>(`/api/admin/keys`);
  return raw.map((k) => ({
    id: String(k.id),
    label: String(k.label),
    providerName: String((k.provider as { name: string })?.name ?? "Unknown"),
    status: String(k.status),
    rpmLimit: (k.rpmLimit as number) ?? null,
    tpmLimit: (k.tpmLimit as number) ?? null,
    poolIds: ((k.poolApiKeys as Array<{ poolId: string }>) ?? []).map((j) => j.poolId),
  }));
}

/** True when stdin is an interactive TTY (we can prompt). */
export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY);
}

/** Prompt the user to pick a numbered option. Auto-picks #1 when non-interactive. */
export async function promptChoice<T>(question: string, options: T[], fmt: (t: T, i: number) => string): Promise<T> {
  if (!isInteractive() || options.length === 1) return options[0];
  while (true) {
    console.log("");
    options.forEach((o, i) => console.log(`  ${i + 1}. ${fmt(o, i)}`));
    const ans = await rl.question(`${question} (1-${options.length}): `);
    const n = parseInt(ans, 10);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) {
      return options[n - 1];
    }
    console.log(`Please enter a number between 1 and ${options.length}.`);
  }
}

/** Prompt the user for a yes/no answer (default true). Auto-accepts when non-interactive. */
export async function promptConfirm(question: string, def = true): Promise<boolean> {
  if (!isInteractive()) return def;
  const suffix = def ? " [Y/n]" : " [y/N]";
  const ans = await rl.question(`${question}${suffix}: `);
  const t = ans.trim().toLowerCase();
  if (t === "") return def;
  return t === "y" || t === "yes";
}

/** Build the gateway request body. */
export function buildRequest(model: string, prompt: string, stream = true) {
  return {
    model,
    stream,
    messages: [{ role: "user", content: prompt }],
  };
}

/** Send one request through the gateway and return the parsed body/status. */
export async function sendGatewayRequest(opts: {
  pool: PoolInfo;
  body: ReturnType<typeof buildRequest>;
  timeoutMs?: number;
}): Promise<{ status: number; body: unknown; headers: Headers }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetch(`${GATEWAY_BASE}/api/gateway/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.pool.gatewayKey ?? ""}`,
      },
      body: JSON.stringify(opts.body),
      signal: controller.signal,
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: res.status, body, headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

/** Read back recent RequestLog rows (newest first) via the logs API. */
export async function listRecentLogs(pageSize = 30): Promise<LogRow[]> {
  const raw = await fetchJson<{ logs: Array<Record<string, unknown>> }>(
    `/api/admin/logs?pageSize=${pageSize}`
  );
  return (raw.logs ?? []).map((l) => ({
    id: String(l.id),
    poolId: (l.poolId as string) ?? null,
    apiKeyId: (l.apiKeyId as string) ?? null,
    apiKeyLabel: String((l.apiKey as { label: string })?.label ?? "—"),
    providerName: String((l.apiKey as { provider: { name: string } })?.provider?.name ?? "—"),
    outcome: String(l.outcome),
    errorClassification: (l.errorClassification as string) ?? null,
    httpStatus: (l.httpStatus as number) ?? null,
    latencyMs: Number(l.latencyMs ?? 0),
    requestedVirtualModel: String(l.requestedVirtualModel ?? ""),
    createdAt: String(l.createdAt),
  }));
}

/** Wait `ms` ms (a simple sleep). */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
