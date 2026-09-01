// ─── System Commands ──────────────────────────────────
// System-wide views: status/dashboard stats, usage, logs,
// settings, benchmark scheduler status.

const api = require("../router-client");
const { style, table, kv, truncate } = require("../ui");

/** Dashboard overview stats. */
async function showStatus() {
  const stats = await api.get("/logs?stats=true").catch(() => null);
  const settings = await api.get("/settings").catch(() => null);

  console.log(style.bold("Router Status"));
  if (stats) {
    console.log(kv([
      ["providers", stats.providerCount ?? "-"],
      ["apiKeys", stats.apiKeyCount ?? "-"],
      ["pools", stats.poolCount ?? "-"],
      ["requestsToday", stats.requestCountToday ?? "-"],
      ["failureRate", stats.failureRateToday ?? "0%"],
      ["healthy", stats.healthyKeys ?? "-"],
      ["penalized", stats.penalizedKeys ?? "-"],
      ["suspended", stats.suspendedKeys ?? "-"],
      ["disabled", stats.disabledKeys ?? "-"],
    ]));
  } else {
    console.log(style.red("Could not load stats."));
  }

  if (settings) {
    console.log(style.bold("\nSettings"));
    console.log(kv([
      ["gatewayKeyPrefix", settings.gatewayKeyPrefix ?? "-"],
      ["penaltyCooldownMs", settings.penaltyCooldownMs ?? "-"],
    ]));
  }
}

/** Show aggregated usage. */
async function showUsage(args) {
  const usage = await api.get("/usage");
  if (!usage || (!usage.tokens && !usage.requests)) {
    console.log(style.dim("No usage recorded."));
    return;
  }
  console.log(kv([
    ["totalTokens", usage.totalTokens ?? "-"],
    ["totalRequests", usage.totalRequests ?? "-"],
    ["totalCost", usage.totalCost ? `$${usage.totalCost}` : "-"],
  ]));
  if (Array.isArray(usage.byProvider) && usage.byProvider.length) {
    console.log(style.bold("\nBy Provider"));
    console.log(table(
      ["PROVIDER", "REQUESTS", "TOKENS", "COST"],
      usage.byProvider.map((r) => [r.name, r.requests ?? 0, r.tokens ?? 0, r.cost ?? "-"])
    ));
  }
}

/** Show recent request logs. */
async function showLogs(args) {
  const n = Math.max(1, Math.min(50, Number(args[0]) || 15));
  const logs = await api.get(`/logs?pageSize=${n}`);
  if (!Array.isArray(logs) || !logs.length) {
    console.log(style.dim("No logs."));
    return;
  }
  console.log(table(
    ["ID", "OUTCOME", "MODEL", "LATENCY"],
    logs.map((l) => [
      l.id,
      l.outcome || "-",
      truncate(l.model || "-", 22),
      l.latencyMs ? `${l.latencyMs}ms` : "-",
    ])
  ));
}

/** Benchmark scheduler status. */
async function showBenchmarks() {
  const status = await api.get("/benchmarks/status");
  console.log(style.bold("Benchmark Scheduler"));
  console.log(kv([
    ["running", status.running ?? "-"],
    ["queued", status.queued ?? "-"],
    ["maxParallel", status.maxParallelTests ?? "-"],
    ["enabled", status.enabled ?? "-"],
  ]));
  if (status.throttleMatrix && Array.isArray(status.throttleMatrix)) {
    console.log(style.bold("\nThrottle Matrix"));
    console.log(table(
      ["KEY", "STATUS", "COOLDOWN", "REMAINING"],
      status.throttleMatrix.map((t) => [t.keyId, t.status, t.cooldownMs ?? "-", t.remainingMs ?? "-"])
    ));
  }
}

/** Trigger a benchmark run. */
async function runBenchmark(args) {
  const body = args[0] ? { apiKeyId: args[0] } : {};
  const result = await api.post("/benchmarks", body);
  console.log(style.green(`Benchmark enqueued (${result.queued ?? 0} keys).`));
}

/** Show / regenerate gateway key. */
async function showSettings(sub) {
  if (sub === "regenerate") {
    const res = await api.put("/settings", { action: "regenerate-key" });
    console.log(style.yellow("New gateway key (shown once):"));
    console.log(style.green(res.plaintextKey));
    return;
  }
  const settings = await api.get("/settings");
  console.log(kv([
    ["gatewayKeyPrefix", settings.gatewayKeyPrefix ?? "-"],
    ["penaltyCooldownMs", settings.penaltyCooldownMs ?? "-"],
    ["benchmarkEnabled", settings.benchmark?.enabled ?? "-"],
    ["benchmarkMaxParallel", settings.benchmark?.maxParallelTests ?? "-"],
  ]));
}

const help = `system commands:
  status             dashboard stats + settings
  usage              aggregated token/request usage
  logs [n]           recent request logs (default 15)
  benchmark          benchmark scheduler status
  benchmark run [keyId]   enqueue a benchmark run
  settings           show settings
  settings regenerate      regenerate the gateway key`;

// Sub-verbs that must NOT be folded into positional args.
const SUB_VERBS = new Set(["run", "regenerate"]);

module.exports = {
  name: "system",
  help,
  async run(sub, args, cmd) {
    // Flat top-level commands (status/usage/logs/settings/benchmark)
    // are routed here. For them, `sub` (when present and not a
    // sub-verb) is really the first positional argument.
    const verb = cmd || sub;
    const combined =
      sub !== undefined && !SUB_VERBS.has(sub) ? [sub, ...args] : args;

    switch (verb) {
      case "status":
      case "sys":
        return showStatus();
      case "usage":
        return showUsage(combined);
      case "logs":
        return showLogs(combined);
      case "benchmark":
      case "bench":
        return sub === "run" ? runBenchmark(combined) : showBenchmarks();
      case "settings":
        return sub === "regenerate" ? showSettings("regenerate") : showSettings();
      default:
        return showStatus();
    }
  },
};
