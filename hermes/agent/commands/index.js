// ─── Command Registry & Dispatch ──────────────────────
// Maps top-level command keywords to their handler module
// and dispatches a raw input line. Returns a promise.

const { style } = require("../ui");
const providers = require("./providers");
const pools = require("./pools");
const drafts = require("./drafts");
const discovery = require("./discovery");
const system = require("./system");

// Top-level aliases → module.
const ROUTES = {
  provider: providers,
  providers: providers,
  pool: pools,
  pools: pools,
  draft: drafts,
  drafts: drafts,
  discover: discovery,
  discovery: discovery,
  requests: discovery, // discovery.requests
  keys: discovery, // discovery.keys
  key: discovery, // discovery.key
  status: system,
  sys: system,
  usage: system,
  logs: system,
  benchmark: system,
  bench: system,
  settings: system,
};

/** Split a line into command + subcommand + args. */
function parse(line) {
  const tokens = line.trim().split(/\s+/);
  return {
    cmd: tokens[0],
    sub: tokens[1],
    args: tokens.slice(2),
  };
}

/** Handle `help [command]`. */
function helpFor(cmd) {
  if (cmd && ROUTES[cmd]) return ROUTES[cmd].help;
  return [
    "Hermes — control console for the LLM Router.",
    "",
    "Available commands:",
    ...Object.keys(ROUTES).map((k) => `  ${style.cyan(k)}`),
    "",
    "Type `help <command>` for details on a specific command.",
    "Type `exit` to quit.",
  ].join("\n");
}

/** Dispatch a parsed input line to the right module. */
async function dispatch(line) {
  const input = String(line).trim();
  if (!input) return;

  // Built-ins.
  if (input === "help" || input === "?" || input === "h") {
    console.log(helpFor());
    return;
  }
  if (input.startsWith("help ")) {
    const topic = input.split(/\s+/)[1];
    console.log(helpFor(topic));
    return;
  }
  if (input === "exit" || input === "quit" || input === "q") {
    console.log(style.yellow("Bye."));
    process.exit(0);
  }

  const { cmd, sub, args } = parse(input);
  const mod = ROUTES[cmd];
  if (!mod) {
    console.log(style.red(`Unknown command: ${cmd}`));
    console.log(style.dim("Type `help` to see available commands."));
    return;
  }

  try {
    await mod.run(sub, args, cmd);
  } catch (err) {
    console.log(style.red(`✖ ${err.message}`));
  }
}

module.exports = { dispatch, helpFor };
