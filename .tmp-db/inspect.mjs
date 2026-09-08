import { createClient } from "@libsql/client";
const db = createClient({ url: "file:./.tmp-db/dev.db.backup-20260904-234515" });
const cols = await db.execute("PRAGMA table_info(AppSettings)");
console.log(cols.rows.map(r => `${r.name} ${r.type} notnull=${r.notnull} dflt=${r.dflt_value}`).join("\n"));
const vals = await db.execute("SELECT id, compactionEnabled FROM AppSettings LIMIT 3");
console.log(JSON.stringify(vals.rows));
