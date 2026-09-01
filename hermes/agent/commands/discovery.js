// ─── Discovery Commands ───────────────────────────────
// Run discovery on demand, list pending research requests,
// and manage API keys / key actions (disable/enable/etc).

const api = require("../router-client");
const { runDiscoverySession } = require("../discovery");
const { style, table, truncate, flag } = require("../ui");

/** Run a discovery session now (optionally with a prompt). */
async function runDiscovery(args) {
  const prompt = args.join(" ").trim() || null;
  console.log(style.dim(prompt ? `Running discovery with prompt: ${prompt}` : "Running discovery…"));
  const drafts = await runDiscoverySession(api.BASE, prompt, null);
  console.log(style.green(`Discovery complete — staged ${drafts.length} draft(s).`));
  return drafts;
}

/** List all research requests (used by the /discovery page). */
async function listRequests() {
  const reqs = await api.get("/discovery/requests");
  const rows = reqs.map((r) => [
    r.id,
    truncate(r.prompt || "(no prompt)", 30),
    r.status || "-",
    r.resultCount ?? 0,
    r.createdAt ? String(r.createdAt).slice(0, 16) : "-",
  ]);
  console.log(table(["ID", "PROMPT", "STATUS", "RESULTS", "CREATED"], rows));
}

/** List all API keys across providers with health. */
async function listKeys() {
  const providers = await api.get("/providers");
  for (const p of providers) {
    let keys = [];
    try {
      keys = await api.get(`/providers/${p.id}/keys`);
    } catch {}
    if (!keys.length) continue;
    console.log(style.bold(`\n${p.name} (${p.id})`));
    console.log(table(
      ["ID", "LABEL", "STATUS", "RPM", "TPM", "CALIBRATED"],
      keys.map((k) => [
        k.id,
        truncate(k.label, 20),
        k.status || "-",
        k.rpmLimit ?? "-",
        k.tpmLimit ?? "-",
        flag(k.calibrated),
      ])
    ));
  }
}

/** Apply an action to a key: disable|enable|reactivate|reset-penalty. */
async function keyAction(keyId, action) {
  const allowed = ["disable", "enable", "reactivate", "reset-penalty"];
  if (!allowed.includes(action)) {
    throw new Error(`action must be one of: ${allowed.join(", ")}`);
  }
  const k = await api.patch(`/keys/${keyId}`, { action });
  console.log(style.yellow(`Key ${keyId} → ${k.status}`));
}

const help = `discovery / keys commands:
  discover [prompt]          run a discovery session now
  requests                   list research requests
  keys                       list all API keys with health
  key <id> <action>          disable|enable|reactivate|reset-penalty`;

module.exports = {
  name: "discover",
  help,
  async run(sub, args, cmd) {
    // Flat top-level aliases routed here: keys / requests / key.
    if (cmd === "keys") return listKeys();
    if (cmd === "requests") return listRequests();
    if (cmd === "key") return keyAction(sub, args[0]);
    // Sub-level forms under `discover` (e.g. `discover requests`).
    if (sub === "requests") return listRequests();
    if (sub === "keys") return listKeys();
    if (sub === "key") return keyAction(args[0], args[1]);
    // `discover [prompt…]` — treat sub + args as the prompt words.
    if (cmd === "discover" || cmd === "discovery") {
      const words = sub !== undefined ? [sub, ...args] : args;
      return runDiscovery(words);
    }
    return listRequests();
  },
};
