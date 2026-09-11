// Runs every verify-*/test-* script via tsx and prints a pass/fail summary.
// Usage: node scripts/run-verifications.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = path.join(ROOT, "scripts");

const targets = fs
  .readdirSync(SCRIPTS)
  .filter((f) => /^(verify-|test-).*\.(ts|cjs)$/.test(f))
  .sort();

let anyFail = false;
for (const f of targets) {
  let out = "";
  let ok = true;
  try {
    out = execFileSync("npx", ["tsx", path.join("scripts", f)], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });
  } catch (e) {
    ok = false;
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  const summary = out
    .split("\n")
    .filter((l) => /passed,|failed|❌|Error:|ERR_MODULE_NOT_FOUND/.test(l))
    .slice(0, 3)
    .join(" | ");
  const status = ok ? "PASS" : "FAIL";
  if (!ok) anyFail = true;
  console.log(`${status}  ${f}  ${summary}`);
}

console.log(anyFail ? "\nSOME VERIFICATIONS FAILED" : "\nALL VERIFICATIONS PASSED");
process.exit(anyFail ? 1 : 0);
