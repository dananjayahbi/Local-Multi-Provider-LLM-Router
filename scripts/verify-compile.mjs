// One-shot verification that reports results via file writes (avoids tty issues).
// Verifies: (1) root tsc has no errors, (2) extension tsc has no errors.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT = path.join(ROOT, "vscode-extension");

const results = [];

function check(name, dir, args) {
  try {
    const out = execFileSync(
      process.execPath,
      [path.join(dir, "node_modules", "typescript", "bin", "tsc"), ...args],
      // stdio: inherit stderr so the "stdout is not a tty" wrapper message is ignored;
      // capture stdout (real diagnostics) as a string.
      { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
    );
    results.push({ name, ok: true, out: (out || "").trim() || "(no diagnostics)" });
  } catch (e) {
    // When tsc reports type errors it exits non-zero with them on stdout.
    results.push({ name, ok: false, out: (e.stdout || "").trim() || "compile failed (see stderr)" });
  }
}

// Run the extension typecheck through the same reliable file-based path.
check("EXTENSION tsc (noEmit)", EXT, ["-p", "./", "--noEmit"]);

check("ROOT tsc (noEmit)", ROOT, ["--noEmit"]);

// Write to a results file readable by the caller.
fs.writeFileSync(path.join(ROOT, "verify-results.json"), JSON.stringify(results, null, 2));
