// ─── Pool Commands ────────────────────────────────────
// Control routing pools: list, create (quick or full), delete.

const api = require("../router-client");
const { style, table, truncate } = require("../ui");

async function listPools() {
  const pools = await api.get("/pools");
  const rows = pools.map((p) => [
    p.id,
    truncate(p.name, 20),
    truncate(p.virtualModelName, 22),
    p.routingStrategy || "-",
    p.members?.length ?? 0,
  ]);
  console.log(table(["ID", "NAME", "VIRTUAL MODEL", "STRATEGY", "MEMBERS"], rows));
}

/** Create a pool. Quick mode: one provider/model. */
async function createPool(args) {
  const [name, virtualModelName, providerModelId, priority] = args;
  if (!name || !virtualModelName || !providerModelId) {
    throw new Error(
      "usage: pool create <name> <virtualModel> <providerModelId> [priority]  (quick)"
    );
  }
  const p = await api.post("/pools", {
    quickMode: true,
    name,
    virtualModelName,
    providerModelId,
    priority: priority ? Number(priority) : undefined,
  });
  console.log(style.green(`Created quick pool ${p.id} (${p.name})`));
  return p;
}

/** Delete a pool. */
async function deletePool(id) {
  await api.del(`/pools/${id}`);
  console.log(style.yellow(`Deleted pool ${id}`));
}

const help = `pool commands:
  pool list                         list all pools
  pool create <name> <virtualModel> <providerModelId> [priority]
  pool delete <id>                  delete a pool`;

module.exports = {
  name: "pool",
  help,
  async run(sub, args) {
    switch (sub) {
      case "list":
      case "ls":
        return listPools();
      case "create":
      case "add":
        return createPool(args);
      case "delete":
      case "rm":
        return deletePool(args[0]);
      default:
        return listPools();
    }
  },
};
