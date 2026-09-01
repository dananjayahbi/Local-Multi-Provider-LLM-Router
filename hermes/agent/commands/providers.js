// ─── Provider Commands ────────────────────────────────
// Control providers: list, inspect, create, update, delete.
// Also list/create keys and models under a provider.

const api = require("../router-client");
const { style, table, kv, flag, truncate } = require("../ui");

const FORMATS = ["CHAT_COMPLETIONS", "MESSAGES", "RESPONSES"];

/** List all providers in a compact table. */
async function listProviders() {
  const providers = await api.get("/providers");
  const rows = providers.map((p) => [
    p.id,
    truncate(p.name, 24),
    p.apiFormat || "-",
    truncate(p.baseUrl, 44),
  ]);
  console.log(table(["ID", "NAME", "FORMAT", "BASE URL"], rows));
}

/** Show a single provider in detail. */
async function showProvider(id) {
  const p = await api.get(`/providers/${id}`);
  console.log(kv([
    ["id", p.id],
    ["name", style.bold(p.name)],
    ["apiFormat", p.apiFormat || "CHAT_COMPLETIONS"],
    ["baseUrl", p.baseUrl],
    ["notes", p.notes || "-"],
  ]));

  console.log(style.bold("\nAPI Keys"));
  try {
    const keys = await api.get(`/providers/${id}/keys`);
    console.log(table(
      ["ID", "LABEL", "STATUS", "RPM", "TPM"],
      keys.map((k) => [k.id, truncate(k.label, 20), k.status || "-", k.rpmLimit ?? "-", k.tpmLimit ?? "-"])
    ));
  } catch (err) {
    console.log(style.red(err.message));
  }

  console.log(style.bold("\nModels"));
  try {
    const models = await api.get(`/providers/${id}/models`);
    console.log(table(
      ["ID", "MODEL ID", "DISPLAY", "VISION", "FN-CALL", "CTX"],
      models.map((m) => [
        m.id,
        truncate(m.modelId, 24),
        truncate(m.displayName, 18),
        flag(m.supportsVision),
        flag(m.supportsFunctionCalling),
        m.contextWindow ?? "-",
      ])
    ));
  } catch (err) {
    console.log(style.red(err.message));
  }
}

/** Create a provider. */
async function createProvider(args) {
  const name = args[0];
  const baseUrl = args[1];
  const apiFormat = (args[2] || "CHAT_COMPLETIONS").toUpperCase();
  if (!name || !baseUrl) {
    throw new Error("usage: provider add <name> <baseUrl> [apiFormat]");
  }
  if (!FORMATS.includes(apiFormat)) {
    throw new Error(`apiFormat must be one of: ${FORMATS.join(", ")}`);
  }
  const p = await api.post("/providers", { name, baseUrl, apiFormat });
  console.log(style.green(`Created provider ${p.id} (${p.name})`));
  return p;
}

/** Delete a provider. */
async function deleteProvider(id) {
  await api.del(`/providers/${id}`);
  console.log(style.yellow(`Deleted provider ${id}`));
}

/** Add an API key to a provider. */
async function addKey(providerId, args) {
  const [label, secret, rpmLimit, tpmLimit] = args;
  if (!providerId || !label || !secret) {
    throw new Error("usage: provider key add <providerId> <label> <secret> [rpmLimit] [tpmLimit]");
  }
  const key = await api.post(`/providers/${providerId}/keys`, {
    label,
    secret,
    rpmLimit: rpmLimit ? Number(rpmLimit) : undefined,
    tpmLimit: tpmLimit ? Number(tpmLimit) : undefined,
  });
  console.log(style.green(`Added API key ${key.id} to provider ${providerId}`));
}

/** List API keys for a provider. */
async function listProviderKeys(providerId) {
  if (!providerId) throw new Error("usage: provider key <providerId>");
  const keys = await api.get(`/providers/${providerId}/keys`);
  console.log(table(
    ["ID", "LABEL", "STATUS", "RPM", "TPM"],
    keys.map((k) => [k.id, truncate(k.label, 20), k.status || "-", k.rpmLimit ?? "-", k.tpmLimit ?? "-"])
  ));
}

/** List models for a provider. */
async function listProviderModels(providerId) {
  if (!providerId) throw new Error("usage: provider model <providerId>");
  const models = await api.get(`/providers/${providerId}/models`);
  console.log(table(
    ["ID", "MODEL ID", "DISPLAY", "VISION", "FN-CALL", "CTX"],
    models.map((m) => [
      m.id,
      truncate(m.modelId, 24),
      truncate(m.displayName, 18),
      flag(m.supportsVision),
      flag(m.supportsFunctionCalling),
      m.contextWindow ?? "-",
    ])
  ));
}

/** Add a model to a provider. */
async function addModel(providerId, args) {
  const [modelId, displayName, contextWindow, supportsVision, supportsFunctionCalling] = args;
  if (!providerId || !modelId) {
    throw new Error("usage: provider model add <providerId> <modelId> [displayName] [contextWindow] [vision] [fnCall]");
  }
  const model = await api.post(`/providers/${providerId}/models`, {
    modelId,
    displayName: displayName || modelId,
    contextWindow: contextWindow ? Number(contextWindow) : undefined,
    supportsVision: supportsVision === "true" || supportsVision === "vision",
    supportsFunctionCalling: supportsFunctionCalling === "true" || supportsFunctionCalling === "fn",
  });
  console.log(style.green(`Added model ${model.id} to provider ${providerId}`));
}

const help = `provider commands:
  provider list                          list all providers
  provider show <id>                     show provider detail (keys + models)
  provider add <name> <baseUrl> [fmt]    create provider (fmt: ${FORMATS.join("|")})
  provider delete <id>                   delete a provider
  provider key add <provId> <label> <secret> [rpm] [tpm]
  provider model add <provId> <modelId> [display] [ctx] [vision] [fnCall]`;

module.exports = {
  name: "provider",
  help,
  async run(sub, args) {
    switch (sub) {
      case "list":
      case "ls":
        return listProviders();
      case "show":
      case "get":
        return showProvider(args[0]);
      case "add":
      case "create":
        return createProvider(args);
      case "delete":
      case "rm":
        return deleteProvider(args[0]);
      case "key":
        return args[0] === "add" || args[0] === "create"
          ? addKey(args[1], args.slice(2))
          : listProviderKeys(args[1]);
      case "model":
        return args[0] === "add" || args[0] === "create"
          ? addModel(args[1], args.slice(2))
          : listProviderModels(args[1]);
      default:
        return listProviders();
    }
  },
};
