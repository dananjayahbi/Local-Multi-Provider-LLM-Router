import { createClient } from "@libsql/client";
const db = createClient({ url: "file:./.tmp-db/dev.db.backup-20260904-234515" });
const keys = await db.execute("SELECT COUNT(*) as c FROM ApiKey");
const pools = await db.execute("SELECT COUNT(*) as c FROM Pool");
const providers = await db.execute("SELECT COUNT(*) as c FROM Provider");
const models = await db.execute("SELECT COUNT(*) as c FROM ProviderModel");
const joins = await db.execute("SELECT COUNT(*) as c FROM PoolApiKey");
console.log(JSON.stringify({
  apiKeys: keys.rows[0].c, pools: pools.rows[0].c,
  providers: providers.rows[0].c, models: models.rows[0].c, poolJoins: joins.rows[0].c
}));
