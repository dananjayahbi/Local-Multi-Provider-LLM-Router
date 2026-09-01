// Temporary: list pools + keys so we can test the context endpoint.
// Writes to a JSON file to avoid the terminal stdout tty quirk.
const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");

const p = new PrismaClient();
(async () => {
  const pools = await p.pool.findMany({
    select: {
      id: true,
      name: true,
      virtualModelName: true,
      gatewayKey: true,
      gatewayKeyPrefix: true,
    },
  });
  const out = pools.map((x) => ({
    id: x.id,
    name: x.name,
    virtualModelName: x.virtualModelName,
    gatewayKeyPrefix: x.gatewayKeyPrefix,
    gatewayKey: x.gatewayKey ? `${x.gatewayKey.slice(0, 6)}...` : null, // masked
    hasKey: !!x.gatewayKey,
  }));
  fs.writeFileSync(
    path.join(__dirname, ".tmp", "pools.json"),
    JSON.stringify(out, null, 2)
  );
  console.log("WROTE", out.length, "pools");
  await p.$disconnect();
})().catch((e) => {
  fs.writeFileSync(path.join(__dirname, ".tmp", "pools-err.json"), String(e));
  process.exit(1);
});
