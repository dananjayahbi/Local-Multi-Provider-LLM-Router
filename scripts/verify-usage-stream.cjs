// Runner (CommonJS): asserts that the stream serializer forwards usage-only
// terminal chunks (empty choices[] + populated usage) to the client while bare
// heartbeats (no choices AND no usage) are still dropped.
//
// Self-contained: writes a temp tsconfig, compiles ONLY the serializer + its
// dependency graph into `.tmp-verify-usage/`, then requires the emitted module
// (patching `@/` aliases). Results are written to `verify-usage-stream.json`
// so a tty-less terminal can read them. Kept as .cjs so bash `!` history
// expansion doesn't corrupt it.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const TMP = path.join(ROOT, ".tmp-verify-usage");
const OUT = path.join(ROOT, "verify-usage-stream.json");

// 1. Clean temp dir.
if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });

// 2. Build a temp tsconfig compiling ONLY the serializer + its deps into TMP.
const baseTsconfig = JSON.parse(fs.readFileSync(path.join(ROOT, "tsconfig.json"), "utf8"));
const verifyTsconfig = {
  ...baseTsconfig,
  compilerOptions: {
    ...(baseTsconfig.compilerOptions || {}),
    module: "commonjs",
    moduleResolution: "bundler",
    outDir: TMP,
    rootDir: path.join(ROOT, "src"),
    types: ["node"],
    noEmit: false,
    emitDeclarationOnly: false,
    incremental: false,
  },
  include: [
    path.join(ROOT, "src", "engine", "serializer.ts"),
    path.join(ROOT, "src", "engine", "canonical.ts"),
    path.join(ROOT, "src", "engine", "response-normalizer.ts"),
  ],
  exclude: [],
};
const tmpTsconfigPath = path.join(ROOT, "scripts", "tsconfig.verify-usage-stream.json");
fs.writeFileSync(tmpTsconfigPath, JSON.stringify(verifyTsconfig, null, 2));

// 3. Compile. This repo's tsc wrapper prints "stdout is not a tty" and exits
//    non-zero even on a successful compile (written to stderr). We treat it as
//    success if the serializer module was actually emitted.
try {
  execFileSync(
    process.execPath,
    [
      path.join(ROOT, "node_modules", "typescript", "bin", "tsc"),
      "-p",
      tmpTsconfigPath,
      "--pretty",
      "false",
    ],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
  );
} catch (e) {
  if (!fs.existsSync(path.join(TMP, "engine", "serializer.js"))) {
    console.error("compile failed:", (e || {}).stdout || (e || {}).message);
    process.exit(1);
  }
  // Emitted fine — the non-zero exit is just the tty wrapper.
}

// 4. Require the compiled serializer, patching `@/` aliases to the compiled dir.
//    rootDir is `${ROOT}/src`, so `@/engine/...` → `${TMP}/engine/...`.
const Module = require("node:module");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    const abs = path.join(TMP, request.slice(2));
    const candidates = [abs, `${abs}.js`, path.join(abs, "index.js")];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  }
  return origResolve.call(Module, request, parent, isMain, options);
};

const serializer = require(path.join(TMP, "engine", "serializer.js"));

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: condition, detail });
  if (!condition) process.stderr.write(`FAIL: ${name} — ${detail}\n`);
  else process.stdout.write(`ok: ${name}\n`);
}

// Test 1: usage-only terminal chunk (empty choices + usage) IS serialized.
const usageOnly = serializer.serializeDelta({
  id: "chatcmpl-abc",
  model: "pool-model",
  choices: [],
  usage: { prompt_tokens: 1193, completion_tokens: 47, total_tokens: 1240 },
});
check(
  "usage-only chunk serialized",
  usageOnly.includes(`"usage":{"prompt_tokens":1193,"completion_tokens":47,"total_tokens":1240}`),
  usageOnly
);
check("usage-only chunk carries empty choices[]", usageOnly.includes(`"choices":[]`), usageOnly);

// Test 2: bare heartbeat (no choices AND no usage) is dropped.
const bare = serializer.serializeDelta({ choices: [] });
check("bare heartbeat dropped", bare === "", `got: ${JSON.stringify(bare)}`);

// Test 3: normal content delta still serialized without a usage field.
const content = serializer.serializeDelta({ choices: [{ index: 0, delta: { content: "hi" } }] });
check(
  "content delta no usage field",
  content.includes("hi") && !content.includes('"usage"'),
  content
);

// Test 4: content delta WITH usage still carries both.
const contentWithUsage = serializer.serializeDelta({
  choices: [{ index: 0, delta: { content: "hi" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
});
check(
  "content+usage delta carries usage",
  contentWithUsage.includes('"usage"') && contentWithUsage.includes('"prompt_tokens":10'),
  contentWithUsage
);

// Test 5: delta with choices undefined but usage present is still serialized.
const undefChoicesUsage = serializer.serializeDelta({
  usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
});
check(
  "choices-undefined + usage serialized",
  undefChoicesUsage.includes('"usage"') && undefChoicesUsage.includes('"choices":[]'),
  undefChoicesUsage
);

const summary = {
  passed: results.filter((r) => r.ok).length,
  failed: results.filter((r) => !r.ok).length,
  total: results.length,
  results,
};
fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));

process.stdout.write(
  `\nverify-usage-stream: ${summary.passed}/${summary.total} passed, ${summary.failed} failed\n`
);
process.exitCode = summary.failed > 0 ? 1 : 0;
